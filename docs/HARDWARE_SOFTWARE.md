# Integração hardware → software — Prédio ON

## 1. Escopo atual

A plataforma desta versão é **somente de monitoramento, telemetria e alertas**. O acionamento remoto de portões foi retirado.

O fluxo é:

```text
Sensores → RS485/Modbus RTU → Gateway → MQTTS → EMQX → Node ingest → TimescaleDB → API → Painéis
```

## 2. Sensores previstos

- nível/volume da caixa d'água;
- falta de fase e grandezas elétricas;
- vazamento;
- fumaça e temperatura;
- estado da bomba;
- estado de disjuntores/proteções.

## 3. Gateway

O gateway lê os dispositivos de campo por RS485/Modbus RTU ou entradas digitais, normaliza os dados e publica MQTT. Ele não expõe os sensores diretamente à internet.

## 4. Tópico MQTT

```text
predio/{buildingId}/device/{deviceId}/telemetry
```

Exemplo:

```text
predio/bld_001/device/water_01/telemetry
```

## 5. Payload de telemetria

```json
{
  "schemaVersion": 1,
  "eventId": "7e18e795-7f70-4f97-a2b9-9fd38f889e6b",
  "buildingId": "bld_001",
  "deviceId": "water_01",
  "metric": "water_level_percent",
  "value": 78,
  "unit": "%",
  "quality": "GOOD",
  "timestamp": "2026-09-19T23:45:00Z"
}
```

## 6. Segurança

- MQTT sobre TLS (porta 8883 em produção);
- credencial exclusiva por gateway;
- ACL limitada ao prédio do gateway;
- validação Zod antes de persistir;
- `eventId` para idempotência com QoS 1;
- RLS no PostgreSQL para isolamento por prédio.

## 7. Mapeamento Modbus

O endereço de registradores depende do manual de cada equipamento. O software mantém esse mapeamento desacoplado do modelo de telemetria para permitir trocar sensores sem alterar o painel.
