# Checklist para una versión pública/demo

Antes de hacer público el repositorio o compartirlo con clientes, conviene revisar:

- [ ] El repositorio no contiene API keys reales.
- [ ] No se subieron archivos `data/*.local.json`.
- [ ] No hay historial personal de apuestas o simulaciones.
- [ ] El README explica cómo ejecutar el proyecto.
- [ ] El proyecto abre correctamente con `INICIAR_PRONOSTIGOL.bat`.
- [ ] Los JS principales pasan verificación:

```powershell
node --check app.js
node --check tournament.js
node --check leagues.js
node --check lab.js
```

- [ ] Agregar capturas en `docs/screenshots/` cuando la interfaz esté lista para mostrarse.
- [ ] Verificar que las capturas no muestran claves, rutas privadas ni datos personales.
- [ ] Decidir si el repo seguirá privado o si se creará un repo demo público separado.

## Recomendación

Mantener este repositorio como laboratorio privado y crear después un repositorio público separado llamado, por ejemplo:

```text
pronostigol-demo
```

Ese repo demo debería contener solo datos de ejemplo, capturas e instrucciones limpias para portafolio.
