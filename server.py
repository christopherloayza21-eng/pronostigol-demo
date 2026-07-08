"""Servidor local de PronostiGol.

Sirve la interfaz y actua como proxy opcional de football-data.org para que la
clave no forme parte del codigo. Solo usa la biblioteca estandar de Python.
"""

from __future__ import annotations

import json
import os
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent
LOCAL_PREDICTIONS = ROOT / "data" / "predictions.local.json"
LOCAL_STATE = ROOT / "data" / "app_state.local.json"
SQL_BRIDGE = ROOT / "sql_bridge.ps1"
API_ROOT = "https://api.football-data.org/v4"
API_SPORTS_ROOT = "https://v3.football.api-sports.io"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _api_key(self):
        return self.headers.get("X-API-Key") or os.getenv("FOOTBALL_DATA_API_KEY", "")

    def _body_json(self):
        size = int(self.headers.get("Content-Length", "0"))
        if size > 5_000_000:
            raise ValueError("Solicitud demasiado grande")
        return json.loads(self.rfile.read(size).decode("utf-8")) if size else None

    def _sql_predictions(self, action, payload=None):
        if not SQL_BRIDGE.exists():
            raise RuntimeError("Puente SQL no disponible")
        sync_file = ROOT / "data" / ".prediction_sync.json"
        if payload is not None:
            sync_file.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        try:
            result = subprocess.run(
                ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(SQL_BRIDGE), action, str(sync_file)],
                cwd=str(ROOT), capture_output=True, text=True, timeout=20, check=False,
            )
            if result.returncode != 0:
                raise RuntimeError(result.stderr.strip() or "SQL Server no disponible")
            return json.loads(result.stdout.strip() or "null")
        finally:
            try:
                sync_file.unlink()
            except FileNotFoundError:
                pass

    def _sql_state(self, action, key, payload=None):
        if not SQL_BRIDGE.exists():
            raise RuntimeError("Puente SQL no disponible")
        sync_file = ROOT / "data" / ".state_sync.json"
        if payload is not None:
            sync_file.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        try:
            result = subprocess.run(
                ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(SQL_BRIDGE), action, str(sync_file), key],
                cwd=str(ROOT), capture_output=True, text=True, timeout=20, check=False,
            )
            if result.returncode != 0:
                raise RuntimeError(result.stderr.strip() or "SQL Server no disponible")
            return json.loads(result.stdout.strip() or "null")
        finally:
            try:
                sync_file.unlink()
            except FileNotFoundError:
                pass

    def _read_state(self, key):
        try:
            return self._sql_state("readstate", key), "sqlserver"
        except Exception:
            try:
                state = json.loads(LOCAL_STATE.read_text(encoding="utf-8"))
                return state.get(key), "local"
            except Exception:
                return None, "local"

    def _write_state(self, key, payload):
        try:
            state = json.loads(LOCAL_STATE.read_text(encoding="utf-8"))
        except Exception:
            state = {}
        state[key] = payload
        LOCAL_STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        try:
            self._sql_state("writestate", key, payload)
            return "sqlserver"
        except Exception:
            return "local"

    def _read_predictions(self):
        try:
            data = self._sql_predictions("read")
            return data if isinstance(data, list) else [], "sqlserver"
        except Exception:
            try:
                return json.loads(LOCAL_PREDICTIONS.read_text(encoding="utf-8")), "local"
            except Exception:
                return [], "local"

    def _write_predictions(self, data):
        LOCAL_PREDICTIONS.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        try:
            self._sql_predictions("write", data)
            return "sqlserver"
        except Exception:
            return "local"

    def _football_data(self, path):
        key = self._api_key()
        if not key:
            return self._json({"error": "Falta la clave de football-data.org"}, 401)
        request = urllib.request.Request(
            f"{API_ROOT}{path}", headers={"X-Auth-Token": key, "User-Agent": "PronostiGol/1.0"}
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                return self._json(json.load(response))
        except urllib.error.HTTPError as error:
            try:
                detail = json.loads(error.read().decode("utf-8"))
            except Exception:
                detail = {"error": "El proveedor rechazo la solicitud"}
            return self._json(detail, error.code)
        except (urllib.error.URLError, TimeoutError):
            return self._json({"error": "No se pudo conectar con el proveedor"}, 502)

    def _api_sports(self, path):
        key = self._api_key()
        if not key:
            return self._json({"error": "Falta la clave de API-Football"}, 401)
        request = urllib.request.Request(
            f"{API_SPORTS_ROOT}{path}",
            headers={"x-apisports-key": key, "User-Agent": "PronostiGol/1.1"},
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                data = json.load(response)
                if data.get("errors"):
                    detail = data["errors"]
                    message = "; ".join(f"{k}: {v}" for k, v in detail.items()) if isinstance(detail, dict) else str(detail)
                    return self._json({"error": message}, 400)
                return self._json(data)
        except urllib.error.HTTPError as error:
            return self._json({"error": "API-Football rechazo la solicitud"}, error.code)
        except (urllib.error.URLError, TimeoutError):
            return self._json({"error": "No se pudo conectar con API-Football"}, 502)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        route = parsed.path
        if route == "/api/health":
            return self._json({"ok": True, "providerConfigured": bool(self._api_key())})
        if route == "/api/predictions":
            predictions, storage = self._read_predictions()
            return self._json({"predictions": predictions, "storage": storage})
        if route.startswith("/api/state/"):
            key = route.removeprefix("/api/state/")
            if key not in {"paper-bets", "fbref-profiles", "settings", "match-contexts", "league-profiles", "league-current"}:
                return self._json({"error": "Conjunto de datos invalido"}, 400)
            value, storage = self._read_state(key)
            return self._json({"value": value, "storage": storage})
        if route == "/api/players":
            data = json.loads((ROOT / "data" / "players.json").read_text(encoding="utf-8"))
            team = urllib.parse.parse_qs(parsed.query).get("team", [""])[0].casefold()
            players = data["players"]
            if team:
                players = [player for player in players if player["team"].casefold() == team]
            return self._json({"players": players, "count": len(players)})
        if route == "/api/officials":
            data = json.loads((ROOT / "data" / "officials.json").read_text(encoding="utf-8"))
            role = urllib.parse.parse_qs(parsed.query).get("role", [""])[0].casefold()
            officials = data["officials"]
            if role:
                officials = [official for official in officials if official["role"].casefold() == role]
            return self._json({"officials": officials, "count": len(officials)})
        if route == "/api/international/world-cup/teams":
            return self._api_sports("/teams?league=1&season=2026")
        if route.startswith("/api/international/teams/") and route.endswith("/matches"):
            team_id = route.split("/")[4]
            if not team_id.isdigit():
                return self._json({"error": "Seleccion invalida"}, 400)
            # Sin filtro de liga: recupera amistosos, clasificatorias y torneos.
            return self._api_sports(f"/fixtures?team={team_id}&last=20&status=FT")
        if route.startswith("/api/competitions/") and route.endswith("/teams"):
            code = route.split("/")[3]
            if not code.replace("-", "").isalnum():
                return self._json({"error": "Competicion invalida"}, 400)
            return self._football_data(f"/competitions/{code}/teams")
        if route.startswith("/api/teams/") and route.endswith("/matches"):
            team_id = route.split("/")[3]
            if not team_id.isdigit():
                return self._json({"error": "Equipo invalido"}, 400)
            # Se consulta margen extra y el cliente conserva los 10 resultados
            # mas recientes entre todas las competiciones disponibles.
            return self._football_data(f"/teams/{team_id}/matches?status=FINISHED&limit=30")
        return super().do_GET()

    def do_POST(self):
        route = urllib.parse.urlparse(self.path).path
        if route == "/api/predictions":
            try:
                data = self._body_json()
                if not isinstance(data, list):
                    raise ValueError("Se esperaba una lista de pronosticos")
                storage = self._write_predictions(data)
                return self._json({"ok": True, "storage": storage})
            except (ValueError, json.JSONDecodeError) as error:
                return self._json({"error": str(error)}, 400)
        if route.startswith("/api/state/"):
            key = route.removeprefix("/api/state/")
            if key not in {"paper-bets", "fbref-profiles", "settings", "match-contexts", "league-profiles", "league-current"}:
                return self._json({"error": "Conjunto de datos invalido"}, 400)
            try:
                payload = self._body_json()
                storage = self._write_state(key, payload)
                return self._json({"ok": True, "storage": storage})
            except (ValueError, json.JSONDecodeError) as error:
                return self._json({"error": str(error)}, 400)
        return self._json({"error": "Ruta no encontrada"}, 404)


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    print(f"PronostiGol listo en http://localhost:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
