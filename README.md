# PIMAU · Plataforma Inteligente de Monitoreo Ambiental Urbano

Plataforma web que integra los datos abiertos de calidad del aire de Santiago
de Cali en un modelo de datos común, con su fuente, su fecha y su estado de
calidad. Es el producto del trabajo de grado de John Sebastian Viana Vargas
(Ingeniería de Sistemas, Universidad de San Buenaventura Cali).

## Estado

| Incremento | Requisitos | Estado |
| --- | --- | --- |
| 1. Integración de datos | RF-01 a RF-04 | En curso |
| 2. Consulta y visualización | RF-05 a RF-09 | Pendiente |
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
backend/            Paquete Python: modelo de datos, migraciones e ingesta
  pimau/db/         Modelo de datos común (ADR-02)
  pimau/ingesta/    Conectores, normalización y ejecución de la ingesta
  migrations/       Migraciones de Alembic
  tests/            Pruebas unitarias y de integración
web/                Aplicación web (incremento 2)
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

Para dejar la ingesta programada según la frecuencia de cada fuente:

```bash
docker compose up -d
```

## Pruebas

```bash
docker compose exec db psql -U pimau -c "CREATE DATABASE pimau_test"
docker compose run --rm \
  -e DATABASE_URL_PRUEBAS=postgresql+psycopg://pimau:<clave>@db:5432/pimau_test \
  ingesta pytest -q
```

## Licencia

Por definir con el director del trabajo de grado.
