const leagueNames = {
  E0: "Premier League",
  E1: "Championship",
  E2: "League One",
  E3: "League Two",
  EC: "National League",
  SP1: "LaLiga",
  SP2: "Segunda España",
  D1: "Bundesliga",
  D2: "2. Bundesliga",
  I1: "Serie A",
  I2: "Serie B",
  F1: "Ligue 1",
  F2: "Ligue 2",
  N1: "Eredivisie",
  P1: "Portugal",
  BSA: "Brasileirao Serie A",
  UCL: "UEFA Champions League",
  UEL: "UEFA Europa League",
  UECL: "UEFA Conference League",
  WC: "FIFA World Cup",
  EURO: "European Championship",
  B1: "Bélgica",
  G1: "Grecia",
  T1: "Turquía",
  SC0: "Escocia Premiership",
  SC1: "Escocia Championship",
  SC2: "Escocia League One",
  SC3: "Escocia League Two",
};

const leagueState = { loaded: false, matches: [], profiles: {}, summary: null, rosters: {}, currentLeagues: {} };
let currentLeaguePrediction = null;
let clubPredictionHistory = [];
try {
  clubPredictionHistory = JSON.parse(localStorage.getItem("pg_club_prediction_history") || "[]");
  if (!Array.isArray(clubPredictionHistory)) clubPredictionHistory = [];
} catch (_) {
  clubPredictionHistory = [];
}
let manualClubFixtures = [];
try {
  manualClubFixtures = JSON.parse(localStorage.getItem("pg_club_manual_fixtures") || "[]");
  if (!Array.isArray(manualClubFixtures)) manualClubFixtures = [];
} catch (_) {
  manualClubFixtures = [];
}
const q = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : "—");
const pct2 = (n) => (Number.isFinite(n) ? `${Math.round(n * 100)}%` : "—");
const statusLabels = { base: "base", permanece: "permanece", ascendido: "ascendido", descendido: "descendido", histórico: "histórico" };

const leagueAliases = {
  "premier league": "E0",
  premier: "E0",
  inglaterra: "E0",
  england: "E0",
  championship: "E1",
  laliga: "SP1",
  "la liga": "SP1",
  "primera division": "SP1",
  "primera espana": "SP1",
  espana: "SP1",
  spain: "SP1",
  "segunda espana": "SP2",
  "segunda division": "SP2",
  laliga2: "SP2",
  bundesliga: "D1",
  alemania: "D1",
  germany: "D1",
  "serie a": "I1",
  italia: "I1",
  italy: "I1",
  "ligue 1": "F1",
  francia: "F1",
  france: "F1",
  eredivisie: "N1",
  holanda: "N1",
  netherlands: "N1",
  portugal: "P1",
  "primeira liga": "P1",
  brasileirao: "BSA",
  brasil: "BSA",
  champions: "UCL",
  "champions league": "UCL",
  "uefa champions league": "UCL",
  ucl: "UCL",
  europa: "UEL",
  "europa league": "UEL",
  uel: "UEL",
  conference: "UECL",
  "conference league": "UECL",
  uecl: "UECL",
  mundial: "WC",
  "world cup": "WC",
  euro: "EURO",
  eurocopa: "EURO",
};

const cupStageLabels = {
  LEAGUE_STAGE: "Fase liga",
  PLAYOFFS: "Playoffs",
  LAST_16: "Octavos de final",
  QUARTER_FINALS: "Cuartos de final",
  SEMI_FINALS: "Semifinales",
  FINAL: "Final",
};
const cupStageOrder = ["PLAYOFFS", "LAST_16", "QUARTER_FINALS", "SEMI_FINALS", "FINAL"];

function leaguePoisson(k, lambda) {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

async function fetchJsonIfExists(path) {
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.json();
  } catch (_) {
    return null;
  }
}

function mergeLeagueRosters(baseRosters, currentData) {
  const merged = JSON.parse(JSON.stringify(baseRosters || {}));
  const currentRosters = currentData?.rosters || {};
  Object.entries(currentRosters).forEach(([season, divisions]) => {
    merged[season] ??= {};
    Object.entries(divisions || {}).forEach(([division, entries]) => {
      if (Array.isArray(entries) && entries.length) merged[season][division] = entries;
    });
  });
  return merged;
}

function availableLeagueDivisions() {
  const divisions = new Set(leagueState.matches.map((m) => m.division).filter(Boolean));
  Object.values(leagueState.rosters || {}).forEach((seasonRosters) => {
    Object.keys(seasonRosters || {}).forEach((division) => divisions.add(division));
  });
  Object.keys(leagueState.currentLeagues || {}).forEach((division) => divisions.add(division));
  return [...divisions].sort((a, b) => (leagueNames[a] || a).localeCompare(leagueNames[b] || b));
}

function divisionKind(division) {
  return leagueState.currentLeagues?.[division]?.kind || leagueState.matches.find((m) => m.division === division)?.competitionKind || "league";
}

function divisionMatchesForView(division, season) {
  const exact = leagueState.matches.filter((m) => m.division === division && m.season === season);
  if (exact.length || divisionKind(division) !== "cup") return exact;
  return leagueState.matches.filter((m) => m.division === division);
}

function completedClubMatch(match) {
  return Number.isFinite(match?.homeGoals) && Number.isFinite(match?.awayGoals);
}

function clubOutcome(homeGoals, awayGoals) {
  return homeGoals > awayGoals ? "home" : awayGoals > homeGoals ? "away" : "draw";
}

function clubPredictionKey(record) {
  return [
    record.matchDate || "",
    record.division || "",
    record.home || "",
    record.away || "",
    record.matchType || "",
  ].join("::").toLowerCase();
}

function clubActualForRecord(record) {
  const sameTeams = (m) => (m.home === record.home && m.away === record.away) || (m.home === record.away && m.away === record.home);
  const savedDay = String(record.savedAt || "").slice(0, 10);
  const candidates = leagueState.matches
    .filter((m) => completedClubMatch(m) && sameTeams(m))
    .filter((m) => !record.matchDate || m.date === record.matchDate)
    .filter((m) => record.matchDate || !savedDay || String(m.date || "") >= savedDay)
    .filter((m) => !record.division || record.matchType !== "league" || m.division === record.division)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const match = candidates[0];
  if (!match) return null;
  const reversed = match.home === record.away && match.away === record.home;
  return {
    id: match.id,
    date: match.date,
    division: match.division,
    homeGoals: reversed ? match.awayGoals : match.homeGoals,
    awayGoals: reversed ? match.homeGoals : match.awayGoals,
    rawHome: match.home,
    rawAway: match.away,
  };
}

function evaluateClubRecord(record) {
  const actual = record.actual || clubActualForRecord(record);
  if (!actual) return null;
  const picks = record.prediction?.picks || {};
  const totalGoals = actual.homeGoals + actual.awayGoals;
  const btts = actual.homeGoals > 0 && actual.awayGoals > 0;
  return {
    actual,
    winner: picks.winner ? clubOutcome(actual.homeGoals, actual.awayGoals) === picks.winner.side : null,
    exact: picks.exact ? actual.homeGoals === picks.exact.homeGoals && actual.awayGoals === picks.exact.awayGoals : null,
    goals: picks.goals ? (picks.goals.side === "over" ? totalGoals > picks.goals.threshold : totalGoals < picks.goals.threshold) : null,
    btts: picks.btts ? btts === (picks.btts.side === "yes") : null,
  };
}

function syncClubHistoryWithResults() {
  let changed = 0;
  clubPredictionHistory.forEach((record) => {
    if (record.actual) return;
    const actual = clubActualForRecord(record);
    if (actual) {
      record.actual = actual;
      record.resolvedAt = new Date().toISOString();
      changed += 1;
    }
  });
  if (changed) saveClubHistory();
  return changed;
}

function saveClubHistory() {
  localStorage.setItem("pg_club_prediction_history", JSON.stringify(clubPredictionHistory));
  if (typeof saveSharedState === "function") saveSharedState("club-predictions", clubPredictionHistory);
  renderClubPredictionHistory();
}

function mergeClubHistory(records) {
  if (!Array.isArray(records) || !records.length) return;
  const byId = new Map(clubPredictionHistory.map((x) => [x.id, x]));
  records.forEach((record) => byId.set(record.id, { ...byId.get(record.id), ...record }));
  clubPredictionHistory = [...byId.values()].sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));
  localStorage.setItem("pg_club_prediction_history", JSON.stringify(clubPredictionHistory));
}

function todayLocalIso() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function dateShiftIso(date, days) {
  const d = date ? new Date(`${date}T12:00:00`) : new Date();
  d.setDate(d.getDate() + days);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function normalizeFixtureType(value) {
  const text = String(value || "").trim().toLowerCase();
  if (/amist|friendly|pretemporada/.test(text)) return "friendly";
  if (/copa|cup|champions|ucl|europa|conference/.test(text)) return "cup";
  return "league";
}

function normalizeLeagueKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function resolveLeagueCode(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const upper = raw.toUpperCase();
  if (leagueNames[upper]) return upper;
  const key = normalizeLeagueKey(raw);
  return leagueAliases[key] || upper;
}

function fixtureTypeLabel(type) {
  return type === "friendly" ? "Amistoso" : type === "cup" ? "Copa" : "Liga";
}

function fixtureDivision(home, away, supplied) {
  const division = resolveLeagueCode(supplied);
  if (division) return division;
  const quick = resolveLeagueCode(q("#clubFixtureCompetition")?.value);
  if (quick) return quick;
  return rosterEntryForAny(home)?.fromDivision || rosterEntryForAny(away)?.fromDivision || leagueState.profiles?.[home]?.division || leagueState.profiles?.[away]?.division || q("#leagueDivision")?.value || "E0";
}

function fixtureContextWarnings(home, away, matchType, division) {
  const homeEntry = rosterEntryForAny(home);
  const awayEntry = rosterEntryForAny(away);
  const homeDivision = homeEntry?.fromDivision || leagueState.profiles?.[home]?.division || "";
  const awayDivision = awayEntry?.fromDivision || leagueState.profiles?.[away]?.division || "";
  const warnings = [];
  if ((matchType === "friendly" || matchType === "cup") && homeDivision && awayDivision && homeDivision !== awayDivision) {
    warnings.push(`Cruce entre divisiones: ${leagueNames[homeDivision] || homeDivision} vs ${leagueNames[awayDivision] || awayDivision}. Puede haber rotaciones y la confianza baja.`);
  }
  if (matchType === "friendly") warnings.push("Amistoso/pretemporada: los equipos suelen probar jugadores, minutos y sistemas.");
  if (matchType === "cup" && !["UCL", "UEL", "UECL"].includes(division)) warnings.push("Copa: si un club grande enfrenta a uno menor, puede guardar titulares.");
  return warnings;
}

function saveManualClubFixtures() {
  manualClubFixtures = manualClubFixtures
    .filter((x) => x && x.date && x.home && x.away)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.home).localeCompare(String(b.home)));
  localStorage.setItem("pg_club_manual_fixtures", JSON.stringify(manualClubFixtures));
  if (typeof saveSharedState === "function") saveSharedState("club-fixtures", manualClubFixtures);
  renderClubCalendar();
}

function mergeManualClubFixtures(records) {
  if (!Array.isArray(records) || !records.length) return;
  const byId = new Map(manualClubFixtures.map((x) => [x.id, x]));
  records.forEach((record) => {
    if (record?.id) byId.set(record.id, { ...byId.get(record.id), ...record });
  });
  manualClubFixtures = [...byId.values()];
  localStorage.setItem("pg_club_manual_fixtures", JSON.stringify(manualClubFixtures));
}

function parseClubFixtureLine(line) {
  const parts = String(line || "").split(/[;,]/).map((x) => x.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  const dateIndex = parts.findIndex((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
  if (dateIndex === -1) return null;
  const date = parts[dateIndex];
  const before = parts.slice(0, dateIndex);
  const after = parts.slice(dateIndex + 1);
  const home = dateIndex === 0 ? after[0] : before[0];
  const away = dateIndex === 0 ? after[1] : before[1];
  const typeRaw = dateIndex === 0 ? after[2] : after[0];
  const divisionRaw = dateIndex === 0 ? after[3] : after[1];
  if (!home || !away || home === away) return null;
  const matchType = normalizeFixtureType(typeRaw);
  const division = fixtureDivision(home, away, divisionRaw);
  return {
    id: `manual_${date}_${home}_${away}_${matchType}`.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
    source: "manual",
    status: "SCHEDULED",
    date,
    home,
    away,
    matchType,
    division,
    competition: leagueNames[division] || division || fixtureTypeLabel(matchType),
    warnings: fixtureContextWarnings(home, away, matchType, division),
    createdAt: new Date().toISOString(),
  };
}

function importClubFixturesFromText() {
  const input = q("#clubFixtureImport");
  const msg = q("#message");
  const fixtures = String(input?.value || "")
    .split(/\r?\n/)
    .map(parseClubFixtureLine)
    .filter(Boolean);
  if (!fixtures.length) {
    if (msg) {
      msg.classList.remove("success", "hidden");
      msg.textContent = "No pude leer partidos. Usa: Barcelona, Como, 2026-07-10, Amistoso, SP1";
    }
    return;
  }
  const byId = new Map(manualClubFixtures.map((x) => [x.id, x]));
  fixtures.forEach((fixture) => byId.set(fixture.id, { ...byId.get(fixture.id), ...fixture }));
  manualClubFixtures = [...byId.values()];
  if (input) input.value = "";
  saveManualClubFixtures();
  if (msg) {
    msg.classList.add("success");
    msg.classList.remove("hidden");
    msg.textContent = `Agenda importada: ${fixtures.length} partido(s).`;
  }
}

function apiClubFixtures() {
  return (leagueState.matches || []).map((m) => {
    const finished = completedClubMatch(m);
    const matchType = divisionKind(m.division) === "cup" ? "cup" : "league";
    return {
      id: `api_${m.division}_${m.date}_${m.home}_${m.away}`.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      source: "api",
      status: finished ? "FINISHED" : (m.status || "SCHEDULED"),
      date: String(m.date || "").slice(0, 10),
      home: m.home,
      away: m.away,
      matchType,
      division: m.division,
      competition: leagueNames[m.division] || m.division,
      homeGoals: m.homeGoals,
      awayGoals: m.awayGoals,
    };
  }).filter((x) => x.date && x.home && x.away);
}

function clubFixturesForDate(date) {
  const selected = date || q("#clubCalendarDate")?.value || todayLocalIso();
  const byId = new Map();
  [...apiClubFixtures(), ...manualClubFixtures].forEach((fixture) => {
    if (fixture.date === selected) byId.set(fixture.id, fixture);
  });
  return [...byId.values()].sort((a, b) => {
    const rank = { api: 0, manual: 1 };
    return (rank[a.source] ?? 9) - (rank[b.source] ?? 9) || String(a.home).localeCompare(String(b.home));
  });
}

function addSelectOptionIfMissing(select, value, label = value) {
  if (!select || !value) return;
  if (![...select.options].some((option) => option.value === value)) {
    select.insertAdjacentHTML("beforeend", `<option value="${esc(value)}">${esc(label)}</option>`);
  }
  select.value = value;
}

function openClubFixture(fixtureId) {
  const fixture = [...apiClubFixtures(), ...manualClubFixtures].find((x) => x.id === fixtureId);
  if (!fixture) return;
  const division = fixtureDivision(fixture.home, fixture.away, fixture.division);
  const matchType = fixture.matchType || normalizeFixtureType(fixture.competition);
  addSelectOptionIfMissing(q("#leagueDivision"), division, `${leagueNames[division] || division} - ${division}`);
  q("#leagueSeason").value = "2026-2027";
  q("#leagueMatchType").value = matchType;
  q("#leagueDivision").value = division;
  q("#leagueMatchDate").value = fixture.date;
  updateLeagueModeUi();
  renderLeagueTeams();
  addSelectOptionIfMissing(q("#leagueHome"), fixture.home, fixture.home);
  addSelectOptionIfMissing(q("#leagueAway"), fixture.away, fixture.away);
  q("#leagueHome").value = fixture.home;
  q("#leagueAway").value = fixture.away;
  predictLeagueMatch();
  q("#leaguePrediction")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function removeManualClubFixture(fixtureId) {
  manualClubFixtures = manualClubFixtures.filter((x) => x.id !== fixtureId);
  saveManualClubFixtures();
}

function renderClubCalendar() {
  const panel = q("#clubCalendarPanel");
  if (!panel) return;
  const dateInput = q("#clubCalendarDate");
  if (dateInput && !dateInput.value) dateInput.value = todayLocalIso();
  const date = dateInput?.value || todayLocalIso();
  const fixtures = clubFixturesForDate(date);
  panel.classList.remove("hidden");
  const status = q("#clubCalendarStatus");
  if (status) status.textContent = `${fixtures.length} partido(s)`;
  const list = q("#clubFixtureList");
  if (!list) return;
  if (!fixtures.length) {
    list.innerHTML = `<div class="club-calendar-empty">No hay partidos cargados para esta fecha. Si es amistoso o copa, pegalo arriba y queda guardado.</div>`;
    return;
  }
  list.innerHTML = fixtures.map((fixture) => {
    const score = Number.isFinite(fixture.homeGoals) && Number.isFinite(fixture.awayGoals) ? `<strong>${fixture.homeGoals}-${fixture.awayGoals}</strong>` : `<strong>VS</strong>`;
    const removable = fixture.source === "manual" ? `<button class="ghost fixture-delete" data-fixture-delete="${esc(fixture.id)}" type="button">Eliminar</button>` : "";
    const warnings = fixture.warnings || fixtureContextWarnings(fixture.home, fixture.away, fixture.matchType, fixture.division);
    const warningHtml = warnings.length ? `<p class="club-fixture-warning">${esc(warnings[0])}</p>` : "";
    return `<div class="club-fixture-card"><div><small>${esc(fixtureTypeLabel(fixture.matchType))} · ${esc(fixture.competition || leagueNames[fixture.division] || fixture.division || "")} · ${fixture.source === "manual" ? "manual" : "API"}</small><h4>${esc(fixture.home)} <span>vs</span> ${esc(fixture.away)}</h4>${warningHtml}</div>${score}<div class="club-fixture-actions"><button class="secondary" data-fixture-open="${esc(fixture.id)}" type="button">Pronóstico</button>${removable}</div></div>`;
  }).join("");
}

function leagueClamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function leagueAvg(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

function teamMatchView(match, team) {
  const home = match.home === team;
  const forGoals = home ? match.homeGoals : match.awayGoals;
  const againstGoals = home ? match.awayGoals : match.homeGoals;
  const stats = match.stats || {};
  const get = (key, side) => Number(stats[key]?.[side]);
  return {
    date: match.date,
    home,
    opponent: home ? match.away : match.home,
    gf: forGoals,
    ga: againstGoals,
    points: forGoals > againstGoals ? 3 : forGoals === againstGoals ? 1 : 0,
    shots: get("shots", home ? "home" : "away"),
    shotsAgainst: get("shots", home ? "away" : "home"),
    sot: get("shotsOnTarget", home ? "home" : "away"),
    sotAgainst: get("shotsOnTarget", home ? "away" : "home"),
    fouls: get("fouls", home ? "home" : "away"),
    corners: get("corners", home ? "home" : "away"),
    cards: get("yellowCards", home ? "home" : "away") + get("redCards", home ? "home" : "away"),
  };
}

function buildLeagueProfiles(matches) {
  const byTeam = {};
  matches.filter((m) => Number.isFinite(m.homeGoals) && Number.isFinite(m.awayGoals)).forEach((m) => {
    [m.home, m.away].forEach((team) => {
      byTeam[team] ??= { team, division: m.division, matches: [] };
      byTeam[team].matches.push(teamMatchView(m, team));
    });
  });
  Object.values(byTeam).forEach((p) => {
    p.matches.sort((a, b) => new Date(b.date) - new Date(a.date));
    const recent = p.matches.slice(0, 10);
    const home = p.matches.filter((x) => x.home).slice(0, 10);
    const away = p.matches.filter((x) => !x.home).slice(0, 10);
    const make = (list) => ({
      n: list.length,
      ppg: leagueAvg(list.map((x) => x.points)),
      gf: leagueAvg(list.map((x) => x.gf)),
      ga: leagueAvg(list.map((x) => x.ga)),
      shots: leagueAvg(list.map((x) => x.shots)),
      sot: leagueAvg(list.map((x) => x.sot)),
      corners: leagueAvg(list.map((x) => x.corners)),
      cards: leagueAvg(list.map((x) => x.cards)),
      fouls: leagueAvg(list.map((x) => x.fouls)),
      over25: list.length ? list.filter((x) => x.gf + x.ga > 2.5).length / list.length : null,
      btts: list.length ? list.filter((x) => x.gf > 0 && x.ga > 0).length / list.length : null,
    });
    p.recent = make(recent);
    p.home = make(home);
    p.away = make(away);
  });
  return byTeam;
}

function leagueSummary(matches, profiles) {
  const divisions = [...new Set(matches.map((m) => m.division))].sort();
  const completed = matches.filter((m) => Number.isFinite(m.homeGoals) && Number.isFinite(m.awayGoals));
  return {
    generatedAt: new Date().toISOString(),
    matches: completed.length,
    divisions: divisions.length,
    teams: Object.keys(profiles).length,
    from: matches.reduce((a, m) => (m.date < a ? m.date : a), matches[0]?.date || ""),
    to: matches.reduce((a, m) => (m.date > a ? m.date : a), matches[0]?.date || ""),
    divisionCounts: Object.fromEntries(divisions.map((d) => [d, matches.filter((m) => m.division === d).length])),
  };
}

function compactLeagueProfiles(profiles) {
  return Object.fromEntries(
    Object.entries(profiles).map(([team, p]) => [team, { team: p.team, division: p.division, recent: p.recent, home: p.home, away: p.away }])
  );
}

const promotionRules = [
  { upper: "E0", lower: "E1", up: 3, down: 3 },
  { upper: "E1", lower: "E2", up: 3, down: 3 },
  { upper: "E2", lower: "E3", up: 4, down: 4 },
  { upper: "E3", lower: "EC", up: 2, down: 2 },
  { upper: "SP1", lower: "SP2", up: 3, down: 3 },
  { upper: "D1", lower: "D2", up: 2, down: 2 },
  { upper: "I1", lower: "I2", up: 3, down: 3 },
  { upper: "F1", lower: "F2", up: 2, down: 2 },
  { upper: "SC0", lower: "SC1", up: 1, down: 1 },
  { upper: "SC1", lower: "SC2", up: 1, down: 1 },
  { upper: "SC2", lower: "SC3", up: 1, down: 1 },
];

function standingsForDivision(matches, division) {
  const table = {};
  const ensure = (team) => (table[team] ??= { team, played: 0, wins: 0, draws: 0, losses: 0, points: 0, gf: 0, ga: 0, gd: 0, form: [] });
  matches.filter((m) => m.division === division && Number.isFinite(m.homeGoals) && Number.isFinite(m.awayGoals)).sort((a, b) => new Date(a.date) - new Date(b.date)).forEach((m) => {
    const h = ensure(m.home);
    const a = ensure(m.away);
    h.played += 1;
    a.played += 1;
    h.gf += m.homeGoals;
    h.ga += m.awayGoals;
    a.gf += m.awayGoals;
    a.ga += m.homeGoals;
    if (m.homeGoals > m.awayGoals) {
      h.points += 3;
      h.wins += 1;
      a.losses += 1;
      h.form.push("G");
      a.form.push("P");
    }
    else if (m.homeGoals < m.awayGoals) {
      a.points += 3;
      a.wins += 1;
      h.losses += 1;
      h.form.push("P");
      a.form.push("G");
    }
    else {
      h.points += 1;
      a.points += 1;
      h.draws += 1;
      a.draws += 1;
      h.form.push("E");
      a.form.push("E");
    }
  });
  Object.values(table).forEach((row) => (row.gd = row.gf - row.ga));
  return Object.values(table).sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team));
}

function leagueTableRows(division, season = selectedLeagueConfig().season) {
  if (!division) return [];
  const baseMatches = season === "2025-2026"
    ? leagueState.matches.filter((m) => m.division === division)
    : leagueState.matches.filter((m) => m.division === division && m.season === season);
  const rows = standingsForDivision(baseMatches, division);
  const byTeam = Object.fromEntries(rows.map((row) => [row.team, row]));
  activeRosterEntries(division, season).forEach((entry) => {
    if (!byTeam[entry.team]) {
      byTeam[entry.team] = { team: entry.team, played: 0, wins: 0, draws: 0, losses: 0, points: 0, gf: 0, ga: 0, gd: 0, form: [], status: entry.status, fromDivision: entry.fromDivision };
    } else {
      byTeam[entry.team].status = entry.status;
      byTeam[entry.team].fromDivision = entry.fromDivision;
    }
  });
  return Object.values(byTeam).sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team));
}

function leagueFormHtml(form = []) {
  const last = form.slice(-5);
  if (!last.length) return `<span class="form-empty">-</span>`;
  return last.map((r) => `<span class="form-dot ${r === "G" ? "win" : r === "P" ? "loss" : "draw"}">${r}</span>`).join("");
}

function cupTieKey(match) {
  return [match.home, match.away].filter(Boolean).sort().join("___");
}

function winnerNameFromMatch(match) {
  if (match.winner === "HOME_TEAM") return match.home;
  if (match.winner === "AWAY_TEAM") return match.away;
  if (match.winner === "DRAW") return "";
  return match.winner || "";
}

function cupTieSummary(matches) {
  const teams = [...new Set(matches.flatMap((m) => [m.home, m.away]).filter(Boolean))];
  const agg = Object.fromEntries(teams.map((team) => [team, 0]));
  matches.forEach((match) => {
    if (Number.isFinite(match.homeGoals)) agg[match.home] = (agg[match.home] || 0) + match.homeGoals;
    if (Number.isFinite(match.awayGoals)) agg[match.away] = (agg[match.away] || 0) + match.awayGoals;
  });
  const winner = teams.length === 2 && agg[teams[0]] !== agg[teams[1]]
    ? (agg[teams[0]] > agg[teams[1]] ? teams[0] : teams[1])
    : winnerNameFromMatch(matches.find((m) => m.winner) || {});
  return { teams, agg, winner };
}

function cupMatchRow(match) {
  const finished = Number.isFinite(match.homeGoals) && Number.isFinite(match.awayGoals);
  const score = finished ? `${match.homeGoals}-${match.awayGoals}` : "vs";
  return `<div class="cup-match-row"><span>${esc(match.date || "")}</span><b>${esc(match.home)}</b><strong>${esc(score)}</strong><b>${esc(match.away)}</b></div>`;
}

function renderCupKnockoutStage(stage, matches) {
  const groups = {};
  matches.forEach((match) => {
    const key = stage === "FINAL" ? String(match.id || cupTieKey(match)) : cupTieKey(match);
    groups[key] ??= [];
    groups[key].push(match);
  });
  const ties = Object.values(groups).map((tieMatches) => {
    tieMatches.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
    const summary = cupTieSummary(tieMatches);
    const aggText = summary.teams.length === 2
      ? `${summary.teams[0]} ${summary.agg[summary.teams[0]] ?? 0}-${summary.agg[summary.teams[1]] ?? 0} ${summary.teams[1]}`
      : "";
    return `<div class="cup-tie"><div class="cup-tie-head"><span>${esc(aggText || "Partido único")}</span>${summary.winner ? `<b>Pasó: ${esc(summary.winner)}</b>` : "<b>Pendiente</b>"}</div>${tieMatches.map(cupMatchRow).join("")}</div>`;
  }).join("");
  return `<section class="cup-stage"><h4>${esc(cupStageLabels[stage] || stage)}</h4><div class="cup-tie-grid">${ties}</div></section>`;
}

function renderCupOverview(panel, division, config) {
  const matches = divisionMatchesForView(division, config.season);
  const seasons = [...new Set(matches.map((m) => m.season).filter(Boolean))].sort().join(", ") || config.season;
  const leagueStageMatches = matches.filter((m) => m.stage === "LEAGUE_STAGE" || !m.stage);
  const rows = standingsForDivision(leagueStageMatches, division).slice(0, 36);
  const knockoutHtml = cupStageOrder
    .map((stage) => [stage, matches.filter((m) => m.stage === stage)])
    .filter(([, stageMatches]) => stageMatches.length)
    .map(([stage, stageMatches]) => renderCupKnockoutStage(stage, stageMatches))
    .join("");
  const champion = matches.filter((m) => m.stage === "FINAL").map((m) => cupTieSummary([m]).winner).find(Boolean);
  const tableHtml = rows.length
    ? `<div class="league-table-wrap"><table class="league-table"><thead><tr><th>#</th><th>Club</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>GF</th><th>GC</th><th>DG</th><th>Pts</th><th>Ultimos 5</th></tr></thead><tbody>${rows.map((row, index) => `<tr><td>${index + 1}</td><td><b>${esc(row.team)}</b></td><td>${row.played}</td><td>${row.wins}</td><td>${row.draws}</td><td>${row.losses}</td><td>${row.gf}</td><td>${row.ga}</td><td>${row.gd}</td><td><strong>${row.points}</strong></td><td>${leagueFormHtml(row.form)}</td></tr>`).join("")}</tbody></table></div>`
    : `<p class="bet-disclaimer">No hay partidos de fase liga cargados para esta copa.</p>`;
  panel.classList.remove("hidden");
  panel.innerHTML = `<div class="panel-title"><div><small>COPA / TORNEO</small><h3>${esc(leagueNames[division] || division)} ${esc(seasons)}</h3></div><span>${champion ? `Campeón: ${esc(champion)}` : `${matches.length} partidos cargados`}</span></div><section class="cup-stage"><h4>Fase liga</h4>${tableHtml}</section><div class="cup-knockout"><div class="panel-title"><h3>Rondas eliminatorias</h3><span>global y clasificado</span></div>${knockoutHtml || "<p class=\"bet-disclaimer\">Todavía no hay eliminatorias cargadas.</p>"}</div>`;
}

function renderLeagueTable() {
  const panel = q("#leagueTablePanel");
  if (!panel || !leagueState.loaded) return;
  const config = selectedLeagueConfig();
  const division = q("#leagueDivision")?.value;
  if (divisionKind(division) === "cup") {
    renderCupOverview(panel, division, config);
    return;
  }
  const rows = leagueTableRows(division, config.season);
  const currentDone = leagueState.matches.filter((m) => m.division === division && m.season === config.season && Number.isFinite(m.homeGoals) && Number.isFinite(m.awayGoals)).length;
  const subtitle = config.season === "2025-2026"
    ? "Tabla final calculada con resultados reales cargados"
    : currentDone ? `Tabla actual con ${currentDone} resultados 26-27 cargados` : "Tabla nueva lista: se llenara cuando entren resultados 26-27";
  panel.classList.remove("hidden");
  panel.innerHTML = `<div class="panel-title"><div><small>TABLA DE POSICIONES</small><h3>${esc(leagueNames[division] || division)} ${esc(config.season)}</h3></div><span>${esc(subtitle)}</span></div><div class="league-table-wrap"><table class="league-table"><thead><tr><th>#</th><th>Club</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>GF</th><th>GC</th><th>DG</th><th>Pts</th><th>Ultimos 5</th></tr></thead><tbody>${rows.map((row, index) => `<tr class="${row.status === "ascendido" ? "promoted" : row.status === "descendido" ? "relegated" : ""}"><td>${index + 1}</td><td><b>${esc(row.team)}</b>${row.status && row.status !== "base" && row.status !== "permanece" ? `<small>${esc(statusLabels[row.status] || row.status)}</small>` : ""}</td><td>${row.played}</td><td>${row.wins}</td><td>${row.draws}</td><td>${row.losses}</td><td>${row.gf}</td><td>${row.ga}</td><td>${row.gd}</td><td><strong>${row.points}</strong></td><td>${leagueFormHtml(row.form)}</td></tr>`).join("")}</tbody></table></div>`;
}

function buildSeasonRosters(matches, profiles) {
  const divisions = [...new Set(matches.map((m) => m.division))].sort();
  const rosters = { "2025-2026": {}, "2026-2027": {} };
  divisions.forEach((division) => {
    const teams = [...new Set(matches.filter((m) => m.division === division).flatMap((m) => [m.home, m.away]))].sort();
    rosters["2025-2026"][division] = teams.map((team) => ({ team, status: "base", fromDivision: division }));
    rosters["2026-2027"][division] = teams.map((team) => ({ team, status: "permanece", fromDivision: profiles[team]?.division || division }));
  });

  promotionRules.forEach(({ upper, lower, up, down }) => {
    const upperTable = standingsForDivision(matches, upper);
    const lowerTable = standingsForDivision(matches, lower);
    if (!upperTable.length || !lowerTable.length || !rosters["2026-2027"][upper] || !rosters["2026-2027"][lower]) return;
    const relegated = upperTable.slice(-down).map((x) => x.team);
    const promoted = lowerTable.slice(0, up).map((x) => x.team);

    rosters["2026-2027"][upper] = rosters["2026-2027"][upper].filter((x) => !relegated.includes(x.team));
    promoted.forEach((team) => {
      if (!rosters["2026-2027"][upper].some((x) => x.team === team)) rosters["2026-2027"][upper].push({ team, status: "ascendido", fromDivision: lower });
    });

    rosters["2026-2027"][lower] = rosters["2026-2027"][lower].filter((x) => !promoted.includes(x.team));
    relegated.forEach((team) => {
      if (!rosters["2026-2027"][lower].some((x) => x.team === team)) rosters["2026-2027"][lower].push({ team, status: "descendido", fromDivision: upper });
    });
  });

  Object.values(rosters).forEach((season) => {
    Object.keys(season).forEach((division) => season[division].sort((a, b) => a.team.localeCompare(b.team)));
  });
  return rosters;
}

function activeRosterEntries(division, season = selectedLeagueConfig().season) {
  return leagueState.rosters?.[season]?.[division] || leagueState.rosters?.["2025-2026"]?.[division] || [];
}

function allClubEntries(season = selectedLeagueConfig().season) {
  const byTeam = {};
  Object.entries(leagueState.profiles || {}).forEach(([team, profile]) => {
    byTeam[team] = { team, status: "histórico", fromDivision: profile.division || "" };
  });
  Object.values(leagueState.rosters?.["2025-2026"] || {}).flat().forEach((entry) => {
    byTeam[entry.team] ??= { ...entry, status: entry.status || "base" };
  });
  Object.values(leagueState.rosters?.[season] || {}).flat().forEach((entry) => {
    byTeam[entry.team] = { ...byTeam[entry.team], ...entry };
  });
  return Object.values(byTeam).sort((a, b) => a.team.localeCompare(b.team));
}

function selectableClubEntries(division, config = selectedLeagueConfig()) {
  return config.matchType === "league" ? activeRosterEntries(division, config.season) : allClubEntries(config.season);
}

function rosterEntryFor(team, division, season = selectedLeagueConfig().season) {
  return activeRosterEntries(division, season).find((x) => x.team === team) || { team, status: "histórico", fromDivision: leagueState.profiles[team]?.division || division };
}

function rosterEntryForAny(team, season = selectedLeagueConfig().season) {
  return allClubEntries(season).find((x) => x.team === team) || { team, status: "histórico", fromDivision: leagueState.profiles[team]?.division || "" };
}

function rosterMovementSummary(division, season = selectedLeagueConfig().season) {
  const entries = activeRosterEntries(division, season);
  return {
    total: entries.length,
    promoted: entries.filter((x) => x.status === "ascendido").length,
    relegated: entries.filter((x) => x.status === "descendido").length,
    moved: entries.filter((x) => x.status === "ascendido" || x.status === "descendido").length,
  };
}

function completedLeagueMatches(division) {
  return leagueState.matches
    .filter((m) => m.division === division && Number.isFinite(m.homeGoals) && Number.isFinite(m.awayGoals))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function teamCompletedMatches(team, division) {
  return completedLeagueMatches(division).filter((m) => m.home === team || m.away === team);
}

function teamHistoricalRecord(team, division) {
  const matches = teamCompletedMatches(team, division);
  const record = { played: matches.length, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, points: 0 };
  matches.forEach((m) => {
    const home = m.home === team;
    const gf = home ? m.homeGoals : m.awayGoals;
    const ga = home ? m.awayGoals : m.homeGoals;
    record.gf += gf;
    record.ga += ga;
    if (gf > ga) {
      record.wins += 1;
      record.points += 3;
    } else if (gf < ga) record.losses += 1;
    else {
      record.draws += 1;
      record.points += 1;
    }
  });
  record.ppg = record.played ? record.points / record.played : null;
  record.gfAvg = record.played ? record.gf / record.played : null;
  record.gaAvg = record.played ? record.ga / record.played : null;
  return record;
}

function resultBadgeFor(team, match) {
  const home = match.home === team;
  const gf = home ? match.homeGoals : match.awayGoals;
  const ga = home ? match.awayGoals : match.homeGoals;
  if (gf > ga) return "G";
  if (gf < ga) return "P";
  return "E";
}

function historicalMatchRow(team, match) {
  const home = match.home === team;
  const rival = home ? match.away : match.home;
  const score = home ? `${match.homeGoals}-${match.awayGoals}` : `${match.awayGoals}-${match.homeGoals}`;
  return `<div class="history-row"><span>${esc(match.date || "")}</span><b>${resultBadgeFor(team, match)}</b><span>${esc(home ? "Local" : "Visita")} vs ${esc(rival)}</span><strong>${esc(score)}</strong></div>`;
}

function clubRate(records, key) {
  const values = records.map(evaluateClubRecord).filter(Boolean).map((x) => x[key]).filter((x) => x !== null);
  return { hits: values.filter(Boolean).length, total: values.length, rate: values.length ? values.filter(Boolean).length / values.length : null };
}

function clubMetricCard(label, metric) {
  return `<div class="league-card"><span>${esc(label)}</span><b>${metric.rate === null ? "—" : pct2(metric.rate)}</b><small>${metric.total ? `${metric.hits} de ${metric.total}` : "Sin muestra"}</small></div>`;
}

function clubBadge(label, value) {
  if (value === null || value === undefined) return `<i class="club-badge neutral">○ ${esc(label)} · falta dato</i>`;
  return `<i class="club-badge ${value ? "hit" : "miss"}">${value ? "✓" : "×"} ${esc(label)}</i>`;
}

function renderClubPredictionHistory() {
  const panel = q("#leagueHistoryPanel");
  if (!panel) return;
  panel.classList.remove("hidden");
  const completed = clubPredictionHistory.filter((record) => record.actual || clubActualForRecord(record));
  const metrics = [
    clubMetricCard("Ganador", clubRate(completed, "winner")),
    clubMetricCard("Marcador", clubRate(completed, "exact")),
    clubMetricCard("Goles", clubRate(completed, "goals")),
    clubMetricCard("BTTS", clubRate(completed, "btts")),
  ].join("");
  if (!clubPredictionHistory.length) {
    panel.innerHTML = `<div class="panel-title"><div><small>CONTROL DE CLUBES</small><h3>Historial de pronósticos de clubes</h3></div><span>0 guardados</span></div><p class="bet-disclaimer">Genera un pronóstico de club y guárdalo antes del partido para medirlo cuando sincronices resultados.</p>`;
    return;
  }
  const rows = clubPredictionHistory.slice(0, 12).map((record) => {
    const evaluation = evaluateClubRecord(record);
    const p = record.prediction;
    const actual = evaluation?.actual;
    const actualHtml = actual ? `<div class="club-history-actual"><span>Resultado registrado</span><b>${actual.homeGoals}-${actual.awayGoals}</b><small>${esc(actual.date || "")}</small></div>` : `<div class="club-history-actual pending"><span>Pendiente</span><b>—</b><small>Sin resultado sincronizado</small></div>`;
    const badges = evaluation
      ? [clubBadge("Ganador", evaluation.winner), clubBadge("Marcador", evaluation.exact), clubBadge(p.picks.goals.label, evaluation.goals), clubBadge(p.picks.btts.label, evaluation.btts)].join("")
      : `<i class="club-badge neutral">○ Esperando resultado</i>`;
    return `<article class="club-history-row"><div><small>${esc(record.matchDate || "sin fecha")} · ${esc(leagueNames[record.division] || record.division)} · ${esc(record.matchType)}</small><h4>${esc(record.home)} vs ${esc(record.away)}</h4></div><div class="club-history-pred"><span>Pronóstico</span><b>${p.score.home}-${p.score.away}</b><small>${pct2(p.probabilities.home)} · ${pct2(p.probabilities.draw)} · ${pct2(p.probabilities.away)}</small></div>${actualHtml}<div class="club-history-badges">${badges}</div></article>`;
  }).join("");
  panel.innerHTML = `<div class="panel-title"><div><small>CONTROL DE CLUBES</small><h3>Historial de pronósticos de clubes</h3></div><span>${clubPredictionHistory.length} guardados · ${completed.length} resueltos</span></div><div class="league-dashboard club-history-summary">${metrics}</div><div class="club-history-list">${rows}</div>`;
}

function updateLeagueModeUi() {
  const config = selectedLeagueConfig();
  const historical = config.season === "2025-2026";
  const title = q("#leagueSectionTitle");
  const button = q("#analyzeLeagueMatch");
  const modeTitle = config.matchType === "friendly" ? "Amistosos de clubes" : config.matchType === "cup" ? "Copas y cruces de clubes" : "Pronostico de ligas 2026-2027";
  if (title) title.textContent = historical ? "Base historica 2025-2026" : modeTitle;
  if (button) button.textContent = historical ? "Analizar historial" : "Generar pronostico";
}

function selectedLeagueConfig() {
  const season = q("#leagueSeason")?.value || "2026-2027";
  const matchType = q("#leagueMatchType")?.value || "league";
  const currentMatches = leagueState.matches.filter((m) => m.season === season).length;
  let weights;

  if (season === "2025-2026") weights = { base: 0.9, current: 0, friendlies: 0, market: 0.1 };
  else if (currentMatches < 30) weights = { base: 0.7, current: 0.05, friendlies: matchType === "friendly" ? 0.15 : 0.05, market: 0.2 };
  else if (currentMatches < 120) weights = { base: 0.5, current: 0.35, friendlies: matchType === "friendly" ? 0.1 : 0.05, market: 0.1 };
  else weights = { base: 0.25, current: 0.65, friendlies: matchType === "friendly" ? 0.05 : 0, market: 0.1 };

  if (matchType === "friendly") {
    weights = { ...weights, base: weights.base * 0.75, current: weights.current * 0.5, friendlies: Math.max(weights.friendlies, 0.2), market: weights.market * 0.75 };
  }
  if (matchType === "cup") {
    weights = { ...weights, base: weights.base * 0.85, current: weights.current * 0.85, market: Math.max(weights.market, 0.15) };
  }

  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  Object.keys(weights).forEach((k) => (weights[k] /= total));
  return { season, matchType, currentMatches, weights };
}

function confidenceForLeague(homeProfile, awayProfile, config, homeEntry, awayEntry, division) {
  const samples = (homeProfile.home.n || 0) + (awayProfile.away.n || 0);
  const sampleScore = Math.min(35, samples * 1.5);
  const seasonPenalty = config.season === "2026-2027" && config.currentMatches < 30 ? 18 : 0;
  const typePenalty = config.matchType === "friendly" ? 22 : config.matchType === "cup" ? 8 : 0;
  const movementPenalty = [homeEntry, awayEntry].filter((x) => x.status === "ascendido" || x.status === "descendido" || (config.matchType === "league" && x.fromDivision !== division)).length * 7;
  const crossDivisionPenalty = config.matchType !== "league" && homeEntry.fromDivision && awayEntry.fromDivision && homeEntry.fromDivision !== awayEntry.fromDivision ? 5 : 0;
  const score = Math.max(25, Math.round(45 + sampleScore - seasonPenalty - typePenalty - movementPenalty - crossDivisionPenalty));
  const level = score >= 72 ? "green" : score >= 55 ? "yellow" : "red";
  const label = level === "green" ? "Confianza alta" : level === "yellow" ? "Confianza media" : "Confianza baja";
  return { score, level, label };
}

function renderLeagueWeights(config, confidence) {
  const panel = q("#leagueWeightsPanel");
  if (!panel) return;
  panel.classList.remove("hidden");
  const labels = { base: "Temporada 25-26", current: "Temporada 26-27", friendlies: "Amistosos", market: "Mercado/cuotas" };
  const typeLabels = { league: "Liga oficial", friendly: "Amistoso / pretemporada", cup: "Copa" };
  panel.innerHTML = `<div class="panel-title"><div><small>PESOS DEL MODELO</small><h3>Entrada a temporada ${esc(config.season)}</h3></div><span class="confidence-pill ${confidence.level}">${confidence.label} - ${confidence.score}/100</span></div><div class="weight-grid">${Object.entries(config.weights).map(([key, value]) => `<div class="weight-box"><span>${esc(labels[key])}</span><b>${pct2(value)}</b></div>`).join("")}</div><p class="bet-disclaimer">Tipo: ${esc(typeLabels[config.matchType] || config.matchType)}. Partidos 26-27 cargados: ${config.currentMatches}. Si aun no hay calendario/resultados nuevos, el sistema usa la 25-26 como base y baja la confianza.</p>`;
}

async function loadLeagueData() {
  q("#leagueStorageStatus").textContent = "Cargando...";
  const res = await fetch("/data/euro_training_2025_2026.json");
  if (!res.ok) throw new Error("No se encontró euro_training_2025_2026.json");
  const data = await res.json();
  const currentData = await fetchJsonIfExists("/data/league_2026_2027.json");
  const baseMatches = data.matches || [];
  const currentMatches = Array.isArray(currentData?.matches) ? currentData.matches : [];
  leagueState.currentLeagues = currentData?.leagues || {};
  leagueState.matches = [...baseMatches, ...currentMatches];
  leagueState.profiles = buildLeagueProfiles(leagueState.matches);
  leagueState.summary = leagueSummary(leagueState.matches, leagueState.profiles);
  leagueState.rosters = mergeLeagueRosters(buildSeasonRosters(baseMatches, leagueState.profiles), currentData);
  leagueState.loaded = true;
  if (typeof loadSharedState === "function") {
    loadSharedState("club-predictions").then((value) => {
      mergeClubHistory(value);
      syncClubHistoryWithResults();
      renderClubPredictionHistory();
    });
    loadSharedState("club-fixtures").then((value) => {
      mergeManualClubFixtures(value);
      renderClubCalendar();
    });
  }
  syncClubHistoryWithResults();
  updateLeagueModeUi();
  renderLeagueControls();
  renderLeagueDashboard();
  renderLeagueTable();
  renderClubPredictionHistory();
  renderClubCalendar();
  if (typeof saveSharedState === "function") {
    saveSharedState("league-profiles", { summary: leagueState.summary, settings: selectedLeagueConfig(), rosters: leagueState.rosters, profiles: compactLeagueProfiles(leagueState.profiles) }).then((storage) => {
      const live = currentMatches.length ? ` + ${currentMatches.length} partidos 26-27` : "";
      q("#leagueStorageStatus").textContent = (storage === "sqlserver" ? "Ligas guardadas en SQL Server" : "Ligas guardadas localmente") + live;
    });
  } else q("#leagueStorageStatus").textContent = "Ligas cargadas";
}

function renderLeagueControls() {
  updateLeagueModeUi();
  const divisions = availableLeagueDivisions();
  const select = q("#leagueDivision");
  select.innerHTML = divisions.map((d) => `<option value="${esc(d)}">${esc(leagueNames[d] || d)} - ${esc(d)}</option>`).join("");
  select.value = divisions.includes("E0") ? "E0" : divisions[0];
  renderLeagueTeams();
  renderLeagueTable();
}

function renderLeagueTeams() {
  const division = q("#leagueDivision").value;
  const config = selectedLeagueConfig();
  const entries = selectableClubEntries(division, config);
  if (!entries.length) {
    q("#leagueHome").innerHTML = `<option value="">Sin equipos cargados</option>`;
    q("#leagueAway").innerHTML = `<option value="">Sin equipos cargados</option>`;
    return;
  }
  const labelFor = (entry) => {
    const source = config.matchType === "league" ? "" : ` - ${leagueNames[entry.fromDivision] || entry.fromDivision || "histórico"}`;
    const status = entry.status !== "base" && entry.status !== "permanece" && entry.status !== "histórico" ? ` - ${statusLabels[entry.status] || entry.status}` : "";
    return `${entry.team}${source}${status}`;
  };
  q("#leagueHome").innerHTML = entries.map((entry) => `<option value="${esc(entry.team)}">${esc(labelFor(entry))}</option>`).join("");
  q("#leagueAway").innerHTML = entries.map((entry) => `<option value="${esc(entry.team)}">${esc(labelFor(entry))}</option>`).join("");
  q("#leagueHome").value = entries[0]?.team || "";
  q("#leagueAway").value = entries.find((t) => t.team !== entries[0]?.team)?.team || entries[1]?.team || "";
}

function renderLeagueDashboard() {
  const s = leagueState.summary;
  if (!s) return;
  const config = selectedLeagueConfig();
  const division = q("#leagueDivision")?.value;
  const rosterCount = division ? selectableClubEntries(division, config).length : 0;
  const moves = division ? rosterMovementSummary(division, config.season) : { promoted: 0, relegated: 0 };
  const participantLabel = config.matchType === "league" ? "Participantes" : "Clubes elegibles";
  const movementLabel = config.matchType === "league" ? "ascensos/descensos estimados" : "modo cruce entre divisiones";
  q("#leagueDashboard").innerHTML = `<div class="league-card"><span>Partidos base</span><b>${s.matches}</b><small>${esc(s.from)} a ${esc(s.to)}</small></div><div class="league-card"><span>Temporada activa</span><b>${esc(config.season)}</b><small>${config.currentMatches} partidos nuevos cargados</small></div><div class="league-card"><span>${participantLabel}</span><b>${rosterCount || s.teams}</b><small>${config.matchType === "league" && division ? esc(leagueNames[division] || division) : "todas las ligas cargadas"}</small></div><div class="league-card"><span>Contexto</span><b>${config.matchType === "league" ? `${moves.promoted}+${moves.relegated}` : config.matchType === "friendly" ? "AM" : "COPA"}</b><small>${movementLabel}</small></div>`;
  renderLeagueTable();
}

function clubProfileHtml(profile, venue, entry, activeDivision) {
  const block = venue === "home" ? profile.home : venue === "away" ? profile.away : profile.recent;
  const move = entry && entry.status !== "base" && entry.status !== "permanece" ? `<small class="roster-note">${esc(statusLabels[entry.status] || entry.status)} desde ${esc(leagueNames[entry.fromDivision] || entry.fromDivision)}</small>` : entry?.fromDivision !== activeDivision ? `<small class="roster-note">perfil historico: ${esc(leagueNames[entry.fromDivision] || entry.fromDivision)}</small>` : "";
  return `<div class="club-profile"><h4>${esc(profile.team)}</h4>${move}<div class="club-stats"><div><span>Muestra</span><b>${block.n}</b></div><div><span>PPG</span><b>${fmt(block.ppg)}</b></div><div><span>GF / GA</span><b>${fmt(block.gf)} / ${fmt(block.ga)}</b></div><div><span>Corners</span><b>${fmt(block.corners)}</b></div><div><span>Tiros arco</span><b>${fmt(block.sot)}</b></div><div><span>Tarjetas</span><b>${fmt(block.cards)}</b></div></div></div>`;
}

function fallbackProfile(team, division) {
  const empty = { n: 0, ppg: null, gf: null, ga: null, shots: null, sot: null, corners: null, cards: null, fouls: null, over25: null, btts: null };
  return { team, division, matches: [], recent: empty, home: empty, away: empty };
}

function profileForTeam(team, division) {
  return leagueState.profiles[team] || fallbackProfile(team, division);
}

function contextMatchesForPrediction(homeProfile, awayProfile, selectedDivision, config) {
  const completed = (m) => Number.isFinite(m.homeGoals) && Number.isFinite(m.awayGoals);
  if (config.matchType === "league" || divisionKind(selectedDivision) === "cup") {
    return leagueState.matches.filter((m) => m.division === selectedDivision && completed(m));
  }
  const divisions = [homeProfile.division, awayProfile.division].filter(Boolean);
  const scoped = leagueState.matches.filter((m) => divisions.includes(m.division) && completed(m));
  return scoped.length ? scoped : leagueState.matches.filter(completed);
}

function historicalRecordCard(team, record) {
  return `<div class="club-profile"><h4>${esc(team)}</h4><div class="club-stats"><div><span>Partidos</span><b>${record.played}</b></div><div><span>G-E-P</span><b>${record.wins}-${record.draws}-${record.losses}</b></div><div><span>Puntos</span><b>${record.points}</b></div><div><span>PPG</span><b>${fmt(record.ppg)}</b></div><div><span>GF prom</span><b>${fmt(record.gfAvg)}</b></div><div><span>GA prom</span><b>${fmt(record.gaAvg)}</b></div></div></div>`;
}

function renderHistoricalLeagueAnalysis(home, away, division) {
  const homeRecord = teamHistoricalRecord(home, division);
  const awayRecord = teamHistoricalRecord(away, division);
  const homeRecent = teamCompletedMatches(home, division).slice(0, 8);
  const awayRecent = teamCompletedMatches(away, division).slice(0, 8);
  const headToHead = completedLeagueMatches(division).filter((m) => [m.home, m.away].includes(home) && [m.home, m.away].includes(away)).slice(0, 8);

  q("#leagueWeightsPanel")?.classList.add("hidden");
  q("#leaguePrediction").classList.remove("hidden");
  q("#leagueMarkets").classList.remove("hidden");

  q("#leaguePrediction").innerHTML = `<div class="panel-title"><div><small>BASE HISTORICA</small><h3>${esc(home)} vs ${esc(away)}</h3></div><span>${esc(leagueNames[division] || division)} 2025-2026</span></div><p class="bet-disclaimer">Este modo no genera apuesta. Sirve para ver resultados reales y entender de donde salen los perfiles que luego usa la temporada nueva.</p><div class="league-team-grid">${historicalRecordCard(home, homeRecord)}${historicalRecordCard(away, awayRecord)}</div><div class="history-split"><div><h4>Ultimos resultados - ${esc(home)}</h4>${homeRecent.length ? homeRecent.map((m) => historicalMatchRow(home, m)).join("") : "<p>No hay resultados.</p>"}</div><div><h4>Ultimos resultados - ${esc(away)}</h4>${awayRecent.length ? awayRecent.map((m) => historicalMatchRow(away, m)).join("") : "<p>No hay resultados.</p>"}</div></div>`;

  q("#leagueMarkets").innerHTML = `<div class="panel-title"><h3>Lectura historica</h3><span>resultados reales</span></div><div class="market-list"><div class="market-row"><span>${esc(home)} puntos por partido</span><b>${fmt(homeRecord.ppg)}</b></div><div class="market-row"><span>${esc(away)} puntos por partido</span><b>${fmt(awayRecord.ppg)}</b></div><div class="market-row"><span>${esc(home)} goles a favor / contra</span><b>${fmt(homeRecord.gfAvg)} / ${fmt(homeRecord.gaAvg)}</b></div><div class="market-row"><span>${esc(away)} goles a favor / contra</span><b>${fmt(awayRecord.gfAvg)} / ${fmt(awayRecord.gaAvg)}</b></div></div><div class="history-headtohead"><h4>Enfrentamientos directos cargados</h4>${headToHead.length ? headToHead.map((m) => `<div class="history-row"><span>${esc(m.date || "")}</span><b>${esc(m.home)}</b><span>${m.homeGoals}-${m.awayGoals}</span><strong>${esc(m.away)}</strong></div>`).join("") : "<p class=\"bet-disclaimer\">No hay enfrentamientos directos en esta base.</p>"}</div>`;
}

function predictLeagueMatch() {
  if (!leagueState.loaded) return;
  const home = q("#leagueHome").value;
  const away = q("#leagueAway").value;
  if (!home || !away || home === away) return;

  const division = q("#leagueDivision").value;
  const hp = profileForTeam(home, division);
  const ap = profileForTeam(away, division);
  const config = selectedLeagueConfig();
  if (config.season === "2025-2026") {
    renderHistoricalLeagueAnalysis(home, away, division);
    renderLeagueDashboard();
    return;
  }
  const homeEntry = config.matchType === "league" ? rosterEntryFor(home, division, config.season) : rosterEntryForAny(home, config.season);
  const awayEntry = config.matchType === "league" ? rosterEntryFor(away, division, config.season) : rosterEntryForAny(away, config.season);
  const warnings = fixtureContextWarnings(home, away, config.matchType, division);
  const confidence = confidenceForLeague(hp, ap, config, homeEntry, awayEntry, division);
  renderLeagueWeights(config, confidence);
  renderLeagueDashboard();

  const leagueMatches = contextMatchesForPrediction(hp, ap, division, config);
  const leagueHomeGoals = leagueAvg(leagueMatches.map((m) => m.homeGoals));
  const leagueAwayGoals = leagueAvg(leagueMatches.map((m) => m.awayGoals));
  const xh = leagueClamp(((hp.home.gf ?? leagueHomeGoals) + (ap.away.ga ?? leagueHomeGoals) + leagueHomeGoals) / 3, 0.25, 3.8);
  const xa = leagueClamp(((ap.away.gf ?? leagueAwayGoals) + (hp.home.ga ?? leagueAwayGoals) + leagueAwayGoals) / 3, 0.2, 3.5);

  let homeWin = 0, draw = 0, awayWin = 0, over25 = 0, btts = 0, best = { h: 0, a: 0, p: 0 };
  for (let h = 0; h <= 7; h++) {
    for (let a = 0; a <= 7; a++) {
      const p = leaguePoisson(h, xh) * leaguePoisson(a, xa);
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;
      if (h + a > 2.5) over25 += p;
      if (h > 0 && a > 0) btts += p;
      if (p > best.p) best = { h, a, p };
    }
  }

  const corners = leagueAvg([hp.home.corners, ap.away.corners]);
  const cards = leagueAvg([hp.home.cards, ap.away.cards]);
  const shots = leagueAvg([hp.home.shots, ap.away.shots]);
  const sot = leagueAvg([hp.home.sot, ap.away.sot]);
  const markets = [
    ["Mas de 1.5 goles", 1 - (leaguePoisson(0, xh + xa) + leaguePoisson(1, xh + xa))],
    ["Mas de 2.5 goles", over25],
    ["Ambos marcan: si", btts],
    [`Mas de ${Math.max(7.5, Math.round((corners ?? 9) - 1) + 0.5)} corners`, 0.58],
    [`Mas de ${Math.max(1.5, Math.round((cards ?? 3) - 1) + 0.5)} tarjetas`, 0.56],
    [`Mas de ${Math.max(17.5, Math.round((shots ?? 20) - 2) + 0.5)} tiros`, 0.55],
    [`Mas de ${Math.max(5.5, Math.round((sot ?? 7) - 1) + 0.5)} tiros al arco`, 0.54],
  ];

  const resultSide = [["home", homeWin], ["draw", draw], ["away", awayWin]].sort((a, b) => b[1] - a[1])[0];
  const goalsPick = over25 >= 0.5
    ? { market: "goals", side: "over", threshold: 2.5, probability: over25, label: "Mas de 2.5 goles" }
    : { market: "goals", side: "under", threshold: 2.5, probability: 1 - over25, label: "Menos de 2.5 goles" };
  const bttsPick = btts >= 0.5
    ? { market: "btts", side: "yes", probability: btts, label: "Ambos marcan: si" }
    : { market: "btts", side: "no", probability: 1 - btts, label: "Ambos marcan: no" };
  currentLeaguePrediction = {
    modelVersion: "club-1.0",
    generatedAt: new Date().toISOString(),
    division,
    competition: leagueNames[division] || division,
    season: config.season,
    matchType: config.matchType,
    matchDate: q("#leagueMatchDate")?.value || null,
    home,
    away,
    score: { home: best.h, away: best.a, probability: best.p },
    expectedGoals: { home: xh, away: xa },
    probabilities: { home: homeWin, draw, away: awayWin, over25, btts },
    confidence,
    warnings,
    context: { homeDivision: hp.division, awayDivision: ap.division, contextMatches: leagueMatches.length },
    picks: {
      winner: { market: "result", side: resultSide[0], probability: resultSide[1], label: resultSide[0] === "home" ? `${home} gana` : resultSide[0] === "away" ? `${away} gana` : "Empate" },
      exact: { market: "exact", homeGoals: best.h, awayGoals: best.a, probability: best.p, label: `Marcador ${best.h}-${best.a}` },
      goals: goalsPick,
      btts: bttsPick,
    },
    markets: markets.map(([label, probability]) => ({ label, probability })),
  };

  q("#leaguePrediction").classList.remove("hidden");
  q("#leagueMarkets").classList.remove("hidden");
  q("#leagueSaveRow")?.classList.remove("hidden");
  const contextText = config.matchType === "league" ? esc(leagueNames[division] || division) : `${esc(leagueNames[hp.division] || hp.division || "histórico")} vs ${esc(leagueNames[ap.division] || ap.division || "histórico")}`;
  const warningHtml = warnings.length ? `<div class="club-warning-box">${warnings.map((w) => `<p>${esc(w)}</p>`).join("")}</div>` : "";
  q("#leaguePrediction").innerHTML = `<div class="panel-title"><h3>${esc(home)} vs ${esc(away)}</h3><span class="confidence-pill ${confidence.level}">${confidence.label} - ${confidence.score}/100</span></div>${warningHtml}<div class="league-team-grid">${clubProfileHtml(hp, "home", homeEntry, division)}${clubProfileHtml(ap, "away", awayEntry, division)}</div><div class="scoreline"><div><b>${esc(home.slice(0, 2).toUpperCase())}</b><span>${esc(home)}</span></div><strong><span>${best.h}</span><i>:</i><span>${best.a}</span></strong><div><b>${esc(away.slice(0, 2).toUpperCase())}</b><span>${esc(away)}</span></div></div><p>Goles esperados: ${esc(home)} ${fmt(xh)} - ${esc(away)} ${fmt(xa)}. Contexto usado: ${contextText}. Ajuste de entrada para ${esc(config.season)}.</p><div class="league-probs">${[["Local", homeWin], ["Empate", draw], ["Visitante", awayWin]].map(([label, p]) => `<div class="league-prob-row"><span>${label}</span><i><em style="width:${Math.round(p * 100)}%"></em></i><b>${pct2(p)}</b></div>`).join("")}</div><p class="bet-disclaimer">Datos usados: ${hp.home.n} partidos como local de ${esc(home)} + ${ap.away.n} como visitante de ${esc(away)}. En amistosos/copas permite equipos de distintas divisiones y baja la confianza si el cruce tiene contexto incompleto. Pesos actuales: base ${pct2(config.weights.base)}, 26-27 ${pct2(config.weights.current)}, amistosos ${pct2(config.weights.friendlies)}, mercado ${pct2(config.weights.market)}.</p>`;
  q("#leagueMarkets").innerHTML = `<div class="panel-title"><h3>Mercados sugeridos</h3><span>${esc(config.season)} - ${esc(config.matchType)}</span></div><div class="market-list">${markets.sort((a, b) => b[1] - a[1]).map(([name, p]) => `<div class="market-row ${p < 0.57 || confidence.level === "red" ? "warn" : ""}"><span>${esc(name)}</span><b>${pct2(p)}</b></div>`).join("")}</div><p class="bet-disclaimer">Modo club inicial: sirve para leer el partido y comparar con cuotas. Si la confianza sale baja, usalo como referencia, no como apuesta directa.</p>`;
}

function saveCurrentLeaguePrediction() {
  const msg = q("#message");
  if (!currentLeaguePrediction) {
    if (msg) {
      msg.classList.remove("success", "hidden");
      msg.textContent = "Primero genera un pronóstico de club.";
    }
    return;
  }
  const baseRecord = {
    id: `club_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    savedAt: new Date().toISOString(),
    home: currentLeaguePrediction.home,
    away: currentLeaguePrediction.away,
    matchDate: currentLeaguePrediction.matchDate,
    division: currentLeaguePrediction.division,
    season: currentLeaguePrediction.season,
    matchType: currentLeaguePrediction.matchType,
    prediction: currentLeaguePrediction,
    actual: null,
  };
  const key = clubPredictionKey(baseRecord);
  const duplicate = clubPredictionHistory.some((record) => !record.actual && clubPredictionKey(record) === key);
  if (duplicate) {
    if (msg) {
      msg.classList.remove("success", "hidden");
      msg.textContent = "Ya existe un pronóstico pendiente para ese partido de club.";
    }
    return;
  }
  baseRecord.actual = clubActualForRecord(baseRecord);
  clubPredictionHistory.unshift(baseRecord);
  saveClubHistory();
  if (msg) {
    msg.classList.add("success");
    msg.classList.remove("hidden");
    msg.textContent = baseRecord.actual ? "Pronóstico guardado y comparado con resultado existente." : "Pronóstico de club guardado. Se comparará cuando sincronices resultados.";
  }
}

q("#loadLeagueData")?.addEventListener("click", () => loadLeagueData().catch((error) => {
  q("#leagueStorageStatus").textContent = "Error";
  const msg = q("#message");
  if (msg) {
    msg.classList.remove("success", "hidden");
    msg.textContent = error.message;
  }
}));
q("#leagueDivision")?.addEventListener("change", () => {
  currentLeaguePrediction = null;
  renderLeagueTeams();
  renderLeagueDashboard();
  renderLeagueTable();
  renderClubCalendar();
  q("#leagueWeightsPanel")?.classList.add("hidden");
  q("#leaguePrediction")?.classList.add("hidden");
  q("#leagueMarkets")?.classList.add("hidden");
  q("#leagueSaveRow")?.classList.add("hidden");
});
q("#analyzeLeagueMatch")?.addEventListener("click", predictLeagueMatch);
q("#saveLeaguePrediction")?.addEventListener("click", saveCurrentLeaguePrediction);
["#leagueSeason", "#leagueMatchType"].forEach((selector) => q(selector)?.addEventListener("change", () => {
  if (!leagueState.loaded) return;
  currentLeaguePrediction = null;
  updateLeagueModeUi();
  renderLeagueTeams();
  renderLeagueDashboard();
  renderLeagueTable();
  renderClubCalendar();
  q("#leagueWeightsPanel")?.classList.add("hidden");
  q("#leaguePrediction")?.classList.add("hidden");
  q("#leagueMarkets")?.classList.add("hidden");
  q("#leagueSaveRow")?.classList.add("hidden");
}));
q("#leagueMatchDate")?.addEventListener("change", () => {
  currentLeaguePrediction = null;
  q("#leagueSaveRow")?.classList.add("hidden");
});
q("#clubCalendarDate")?.addEventListener("change", renderClubCalendar);
q("#clubCalendarPrev")?.addEventListener("click", () => {
  const input = q("#clubCalendarDate");
  if (!input) return;
  input.value = dateShiftIso(input.value, -1);
  renderClubCalendar();
});
q("#clubCalendarToday")?.addEventListener("click", () => {
  const input = q("#clubCalendarDate");
  if (!input) return;
  input.value = todayLocalIso();
  renderClubCalendar();
});
q("#clubCalendarNext")?.addEventListener("click", () => {
  const input = q("#clubCalendarDate");
  if (!input) return;
  input.value = dateShiftIso(input.value, 1);
  renderClubCalendar();
});
q("#importClubFixtures")?.addEventListener("click", importClubFixturesFromText);
q("#clubFixtureList")?.addEventListener("click", (event) => {
  const openButton = event.target.closest("[data-fixture-open]");
  if (openButton) {
    openClubFixture(openButton.dataset.fixtureOpen);
    return;
  }
  const deleteButton = event.target.closest("[data-fixture-delete]");
  if (deleteButton) removeManualClubFixture(deleteButton.dataset.fixtureDelete);
});
