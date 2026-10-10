# PIMAU · Plataforma Inteligente de Monitoreo Ambiental Urbano

Plataforma web que integra los datos abiertos de calidad del aire de Santiago
de Cali en un modelo de datos común, con su fuente, su fecha y su estado de
calidad. Es el producto del trabajo de grado de John Sebastian Viana Vargas
(Ingeniería de Sistemas, Universidad de San Buenaventura Cali).

## Estado

| Incremento | Requisitos | Estado |
| --- | --- | --- |
| 1. Integración de datos | RF-01 a RF-04 | Hecho |
| 2. Consulta y visualización | RF-05 a RF-09 | En curso: API y visor funcionando |
| 3. Administración | RF-10 y RF-11 | Pendiente |
| 4. Analítica (Semestre 8) | RF-12 a RF-14 | Pendiente |
| 5. Nuevas variables (Semestre 8) | RF-15 | Pendiente |

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

Para desarrollar el visor con recarga automática (requiere Node 22):

```bash
cd web && npm install && npm run dev
```

## Pruebas

Visor:

```bash
cd web && npm test
```

Backend:

```bash
docker compose exec db psql -U pimau -c "CREATE DATABASE pimau_test"
docker compose run --rm \
  -e DATABASE_URL_PRUEBAS=postgresql+psycopg://pimau:<clave>@db:5432/pimau_test \
  ingesta pytest -q
```

## Licencia

Por definir con el director del trabajo de grado.
