# Prédio ON — Property Operations and IoT Monitoring

A modular platform that connects property telemetry with daily condominium operations. It combines an Express API, MQTT ingestion, durable notification delivery, PostgreSQL/TimescaleDB, three web portals and resident/operations mobile apps.

**Start with:** [visual gallery](docs/IMAGENS_DOS_SISTEMAS.md) · [demonstration videos](docs/videos/README.md) · [product requirements](docs/PRD.md) · [technical design](docs/TDD.md) · [current delivery record](docs/CONTINUIDADE.md).

## Product walkthrough

1. A gateway or simulator publishes telemetry such as tank level, electrical readings, pump state or environmental signals.
2. Ingestion validates and stores the readings, evaluates configured rules and records alert-delivery work.
3. A manager investigates alerts, acknowledges issues and handles notices, reservations, maintenance and resident requests.
4. Residents see the information and actions granted to their account, including published notices, their own requests, reservations and authorized access operations.

The broader platform also covers parking availability, financial transparency, assets, work orders and recorded remote-support requests. Visibility and permitted operations depend on property configuration and capabilities.

## Architecture and reading guide

```text
Sensors / simulator → MQTT / EMQX → ingestion → PostgreSQL + TimescaleDB
                                              ↕
                                         Express API
                                   ↙          ↓          ↘
                           Admin web   Building web   Resident web/apps
                                              ↓
                                  durable outbox → notification worker
```

| Location | Responsibility |
| --- | --- |
| [apps/api](apps/api) | Authentication, authorization and domain endpoints. |
| [services/ingest](services/ingest) | MQTT telemetry, rules, access commands and simulators. |
| [services/notifications](services/notifications) | Restricted webhook-delivery worker. |
| [packages/db](packages/db) | Drizzle schema, migrations, restricted roles and RLS context. |
| [packages/contracts](packages/contracts), [packages/shared](packages/shared), [packages/api-client](packages/api-client) | Shared contracts, validation and authenticated clients. |
| [packages/mobile](packages/mobile) | Shared React Native UI/session behavior for the resident and operations apps. |

The web applications use React/Vite; the mobile apps use React Native without the Expo SDK. EAS is an optional build/distribution service, not a change to that application architecture. The resident web portal remains available. There is no platform-administrator mobile app.

## Local demonstration

Use a Node.js version compatible with the monorepo (`^22.13.0`, `^24.3.0` or `>=26`), **pnpm 10.17.1** and Docker Compose. The following commands are for a disposable local demonstration, not an update of a real installation.

```powershell
pnpm install --frozen-lockfile
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
pnpm setup:local
pnpm dev
```

`setup:local` starts TimescaleDB/PostgreSQL and EMQX, bootstraps an empty database, applies pending versioned SQL, provisions restricted connections and seeds demonstration data. **The seed resets local demonstration passwords.** Obtain demonstration account details from the local seed configuration; do not reuse those credentials outside the lab.

The local database is on `127.0.0.1:5434`, MQTT on `127.0.0.1:1883`, EMQX dashboard on `127.0.0.1:18083`, API on port 3000 and web portals on 5173–5175. Open the Vite-served applications, not their HTML files directly. Use `pnpm simulate:hardware` to explore telemetry without a physical device.

For subsequent starts, `.\scripts\start-local.ps1` checks the environment and migration history without applying migrations. After reviewing an update, use `-Setup` without `-SeedDemo` to apply preparation steps while preserving demonstration-independent data. `pnpm dev` alone does not start infrastructure or validate migrations. `pnpm infra:reset` deletes local database volumes and is not a normal upgrade step.

## Decisions and trade-offs

The [product architecture](docs/superpowers/specs/2026-09-27-arquitetura-produto-design.md), [notification contract](docs/NOTIFICACOES_DURAVEIS.md) and [migration guide](docs/MIGRATIONS.md) record the main decisions.

| Choice | Benefit | Cost or boundary |
| --- | --- | --- |
| Shared modular platform with separate role-specific interfaces | Reuses domain contracts while giving residents and operators different workflows. | Permission changes must be enforced by API/database boundaries, not only navigation. |
| MQTT plus time-series storage | Fits continuously arriving sensor readings and historical analysis. | Requires continuously running ingestion/broker services, calibrated hardware and retention management. |
| Restricted database roles and RLS | Narrows each service's data authority. | Provisioning, transaction context and migrations are more demanding than one owner connection. |
| Atomic notification outbox and leased worker | Preserves delivery intent alongside the business event and supports recovery. | Remote webhook delivery can still be ambiguous or duplicate; stable idempotency and operational review remain necessary. |
| Versioned SQL with checksums and migration history | Detects changed history and avoids silently applying an unknown database state. | Legacy databases without valid history need reviewed adoption/recovery rather than automatic repair. |
| Explicit command/ACK access model | Separates a requested gate action from the controller's reported execution. | An ACK does not measure the gate's physical position or replace a safety system. |

## Verification and current scope

```bash
pnpm check:boundaries
pnpm typecheck
pnpm test
pnpm typecheck:e2e
pnpm test:e2e:chromium
```

Use [the E2E guide](e2e/README.md) for required services, isolated databases and browser installation. Some database/RBAC/access tests require explicit test-database configuration and opt-in flags; skipped tests are not successful integration evidence. Record real hardware, mobile-device and installation verification separately from simulations.

The [continuity record](docs/CONTINUIDADE.md) and dated validation documents are authoritative for completed checks and open work. A web demonstration is documented in [Vercel/Neon deployment notes](docs/VERCEL_NEON.md); it does not establish production acceptance of continuous services or field hardware. Plans/subscriptions remain outside the delivered scope described by the current project notes. Signed iOS distribution remains a separately tracked validation step.

Mandatory platform-administrator MFA is not yet a delivered end-to-end feature. The [current MFA checkpoint](docs/continuidade/2026-11-04-mfa-integracao/README.md) separates published client transport handling from candidate backend and web/mobile integration. Its isolated unit results do not establish SQL, HTTP/SSE or device acceptance.

## Deployment and operational boundaries

Use [the current installation manual](docs/IMPLANTACAO_CONDOMINIO.md), [deployment guide](docs/DEPLOY.md), [database setup](docs/DATABASE_SETUP.md) and [backup/restore guide](docs/BACKUP_E_RESTAURACAO.md). Administrative and restricted runtime connections have distinct responsibilities. Ingestion uses its generated restricted runtime environment and must not fall back to the database-owner connection.

- Sensor values and estimated costs depend on installation, calibration and configured tariffs. Statistical anomalies indicate investigation, not an automatically diagnosed cause.
- Smoke/gas signals do not replace certified safety equipment. Gate requests and ACKs must be interpreted using [the access contract](docs/ACESSOS.md).
- Resend handles invitations/password recovery. Alert email/WhatsApp delivery requires an external webhook integration; mobile push is not implemented.
- Remote-support records do not prove that an AnyDesk session took place. Review [support boundaries](docs/SUPORTE_REMOTO.md).
- An empty notification destination can finish work as `no_destination`; configuring a destination later does not retroactively resend it. Follow the notification migration/rollback guide.

Further references: [authentication](docs/AUTENTICACAO.md) · [authorization](docs/AUTORIZACAO.md) · [password changes](docs/TROCA_DE_SENHA.md) · [audit](docs/AUDITORIA.md) · [sensors](docs/SENSORES.md) · [consumption analysis](docs/CONSUMO_E_ANALISE.md) · [mobile apps](packages/mobile/README.md) · [full documentation](docs).
