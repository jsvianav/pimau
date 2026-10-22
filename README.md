# PIMAU · Plataforma Inteligente de Monitoreo Ambiental Urbano

Plataforma web que integra los datos abiertos de calidad del aire y de
meteorología de Santiago de Cali en un modelo de datos común, con su fuente, su fecha y su estado de
calidad. Es el producto del trabajo de grado de John Sebastian Viana Vargas
(Ingeniería de Sistemas, Universidad de San Buenaventura Cali).

## Estado

| Incremento | Requisitos | Estado |
| --- | --- | --- |
| 1. Integración de datos | RF-01 a RF-04 | Hecho |
| 2. Consulta y visualización | RF-05 a RF-09 | Hecho; faltan las pruebas de extremo a extremo y de accesibilidad |
| 3. Administración | RF-10 y RF-11 | Hecho; falta el despliegue en producción |
| 4. Analítica (Semestre 8) | RF-12 a RF-14 | Anomalías (RF-13) y alertas por umbral (RF-14) hechas; falta el pronóstico (RF-12) |
| 5. Nuevas variables (Semestre 8) | RF-15 | Ruido de SATIC hecho; falta el del portal de Cali (fuera de línea) |

El avance, las decisiones y los problemas se registran en
[docs/bitacora.md](docs/bitacora.md).

## Fuentes

| Fuente | Acceso | Estado |
| --- | --- | --- |
| IDEAM en datos.gov.co | API Socrata | Activa |
| Datos Abiertos de Cali (DAGMA) | API CKAN | Activa |
| IDESC (comunas y barrios) | OGC WFS | Activa |
| SATIC (red OAC22) | API no documentada | Inactiva, en espera de autorización |
| OpenAQ | API REST | Inactiva, falta la clave de API |

## Estructura

```
backend/            Paquete Python con un módulo por capa del ADR-01
  pimau/db/         Almacenamiento: modelo de datos común (ADR-02)
  pimau/ingesta/    Ingesta y normalización: conectores por fuente
  pimau/api/        Servicios: API de consulta con FastAPI y cálculo del ICA
  migrations/       Migraciones de Alembic
  tests/            Pruebas unitarias, de integración y de arquitectura
web/                Presentación: visor con React y MapLibre GL JS
analitica/          Servicio analítico (Semestre 8)
docs/               Bitácora y documentos de gestión
```

## Cómo ejecutarlo

Requiere Docker.

```bash
cp .env.example .env          # y cambie la contraseña
docker compose up -d db
docker compose run --rm ingesta alembic upgrade head
docker compose run --rm ingesta python -m pimau.ingesta ejecutar --completa
docker compose run --rm ingesta python -m pimau.ingesta estado
```

Para levantar toda la plataforma (base de datos, ingesta programada, API y
visor):

```bash
docker compose up -d
```

- Visor: http://localhost:8080
- API y su documentación: http://localhost:8080/api/docs

Para usar la pestaña Administración, defina `JWT_SECRETO` en `.env` (ver
`.env.example`) y cree el administrador; la contraseña se pide sin mostrarla:

```bash
docker compose exec api python -m pimau.api.administradores crear --correo admin@ejemplo.org
```

Para desarrollar el visor con recarga automática (requiere Node 22):

```bash
cd web && npm install && npm run dev
```

## Pruebas y linter

Visor:

```bash
cd web && npm run lint && npm test
```

Backend (Ruff revisa el estilo PEP 8 y los errores comunes):

```bash
docker compose exec db psql -U pimau -c "CREATE DATABASE pimau_test"
docker compose run --rm -v "$PWD/backend:/app" \
  -e DATABASE_URL_PRUEBAS=postgresql+psycopg://pimau:<clave>@db:5432/pimau_test \
  ingesta sh -c "pip install -q -r requirements-dev.txt && ruff check . && pytest -q"
```

La integración continua (`.github/workflows/ci.yml`) corre lo mismo en cada
cambio, revisa las dependencias vulnerables (`pip-audit` y `npm audit`) y
construye las imágenes de los contenedores.

## Respaldos

El servicio `respaldo` guarda cada día un volcado de la base en `respaldos/`
y conserva los últimos 7. Para restaurar uno:

```bash
docker compose run --rm --entrypoint sh respaldo -c \
  "pg_restore --clean -d pimau /respaldos/pimau_AAAAMMDD.dump"
```

La base de datos no publica su puerto: solo los demás contenedores llegan a
ella por la red interna de Docker.

## Licencia

Por definir con el director del trabajo de grado.
