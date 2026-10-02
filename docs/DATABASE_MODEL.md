# Modelo de dados — Prédio ON

Este resumo descreve parte do schema existente. A [arquitetura de produto revisada](superpowers/specs/2026-09-27-arquitetura-produto-design.md) detalha as entidades atuais e propostas para unidades, equipes, RBAC, sessões, ativos, manutenção, automações, planos e filas. Essas novas entidades ainda não foram aplicadas ao banco.

## ERD simplificado

```mermaid
erDiagram
  ORGANIZATIONS ||--o{ BUILDINGS : owns
  BUILDINGS ||--o{ MEMBERSHIPS : has
  USERS ||--o{ MEMBERSHIPS : belongs
  BUILDINGS ||--o{ GATEWAYS : has
  GATEWAYS ||--o{ DEVICES : connects
  DEVICES ||--o{ DEVICE_METRICS : exposes
  DEVICES ||--o{ TELEMETRY : produces
  DEVICES ||--o{ ALERT_RULES : monitored_by
  ALERT_RULES ||--o{ ALERTS : triggers
  BUILDINGS ||--o{ AUDIT_LOGS : records
```

## Tabelas

| Tabela | Finalidade |
|---|---|
| `users` | Usuários da plataforma |
| `organizations` | Clientes/organizações |
| `buildings` | Prédios/condomínios |
| `memberships` | Vínculo e papel do usuário no prédio |
| `gateways` | Gateway físico instalado no prédio |
| `devices` | Sensores e monitores conectados |
| `device_metrics` | Métricas expostas por cada dispositivo |
| `ingest_events` | Idempotência da ingestão MQTT |
| `telemetry` | Série temporal de medições |
| `alert_rules` | Regras configuráveis de limite |
| `alerts` | Ocorrências geradas pelas regras |
| `audit_logs` | Auditoria de ações administrativas |

## Multi-tenancy

A coluna `building_id` é a principal fronteira de isolamento. A API aplica RBAC e o PostgreSQL usa RLS como segunda camada de segurança.

Na arquitetura de destino, cada condomínio/imóvel continua sendo o tenant operacional, identificado por `buildings.id`. `organizations` agrupa clientes comercialmente; esse agrupamento não deve conceder acesso operacional implícito aos demais condomínios. Identidades e catálogos globais, dados comerciais e dados do condomínio têm políticas de escopo distintas, descritas na arquitetura revisada.

## Telemetria

`telemetry` é transformada em hypertable do TimescaleDB. O valor original fica em `value` e, quando numérico, também em `numeric_value` para consultas de limiar/agregação.

## Idempotência

MQTT QoS 1 pode entregar a mesma mensagem mais de uma vez. Antes de gravar a série temporal, o ingest tenta registrar `event_id` em `ingest_events`; se o ID já existir, a mensagem duplicada é descartada.

## Alertas

As regras ficam em `alert_rules`, com operador, limiar, severidade e cooldown. Quando uma medição atende à condição, o sistema cria uma linha em `alerts`.

## Escala

A evolução prevista mantém o banco central e separa API, recepção IoT e workers por carga. A execução horizontal ainda exige validar deduplicação, reservas de trabalho, ordenação, pools de conexão e recuperação; o cliente MQTT fixo atual não pode ser replicado sem adaptação. TimescaleDB organiza o histórico temporal, mas capacidade e retenção dependem de dimensionamento e ensaios de carga.
