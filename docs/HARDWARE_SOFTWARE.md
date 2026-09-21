# Integração hardware → software — Prédio ON

Contrato vigente da caixa d'água e entrega local: [ENTREGA_HELBER.md](ENTREGA_HELBER.md).

## 1. Escopo

A plataforma é de **monitoramento, telemetria e alertas**. Não existe acionamento remoto de
nenhum equipamento: não há comando de saída, não há relé controlado pela nuvem, não há
abertura de portão. Um portão só pode aparecer aqui como **sensor de estado** (leitura), nunca
como atuador.

```text
Sensores → RS485/Modbus RTU ou entrada digital → Gateway → MQTTS → EMQX
        → Node ingest → TimescaleDB → API → Painéis
```

## 2. Sensores previstos

| Grandeza | Interface típica | Observação |
|---|---|---|
| Nível/volume da caixa d'água | RS485 Modbus | Ultrassônico ou transmissor de pressão |
| Tensão por fase e falta de fase | RS485 Modbus | Multimedidor; a proteção continua sendo relé físico |
| Vazamento | Entrada digital | Cabo sensor ou sonda de eletrodos |
| Estado da bomba | Entrada digital + TC | Contato auxiliar diz "comandada", corrente diz "bombeando" |
| Temperatura de sala técnica | RS485 Modbus | SHT20 ou equivalente |
| Fumaça / incêndio | Entrada digital | ⚠️ Ver seção 7 |
| Estado de disjuntor | Entrada digital | Bloco de contato auxiliar |

## 3. Gateway

O gateway lê os dispositivos de campo, normaliza e publica MQTT. Ele **não** expõe os sensores
à internet e **não** recebe comandos da plataforma.

Requisitos do gateway em produção:

- computador embarcado (não um conversor serial puro), para fazer o polling Modbus localmente;
- buffer local (store-and-forward) para não perder leitura durante queda de link;
- credencial MQTT própria, emitida no painel administrador em **Gateways → Gerar credencial**.

## 4. Tópicos

```text
predio/{buildingId}/caixa_agua/{deviceId}/telemetria
predio/{buildingId}/device/{deviceId}/telemetry
predio/{buildingId}/gateway/{gatewayId}/status
```

O tópico de status deve ser publicado **retido** na conexão e registrado como **last will**,
para que o broker anuncie a queda do gateway sem esperar o timeout.

## 5. Payloads

O primeiro tópico recebe o JSON compacto (`device_id`, `type`, `nivel_percentual`,
`distancia_mm`, `volume_litros`, `timestamp`) descrito na entrega. Os dois campos de
distância e volume são opcionais. O segundo tópico mantém o formato genérico abaixo:

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

Status do gateway:

```json
{
  "schemaVersion": 1,
  "buildingId": "bld_001",
  "gatewayId": "gw_001",
  "state": "ONLINE",
  "firmwareVersion": "1.2.0",
  "timestamp": "2026-09-19T23:45:00Z"
}
```

Os schemas são a fonte da verdade e vivem em `packages/shared/src/telemetry.ts`.

## 6. O que a plataforma rejeita

| Situação | O que acontece |
|---|---|
| Payload fora do schema | Mensagem descartada, log de aviso |
| `buildingId`/`deviceId` do payload diferente do tópico | Mensagem descartada |
| Dispositivo não cadastrado naquele prédio | Mensagem descartada |
| Mesmo `eventId` reenviado (QoS 1) | Gravada uma vez só |
| Gateway sem publicar além do timeout | Marcado OFFLINE e gera alerta |

O tópico é a fonte de verdade da identidade, porque é ele que a ACL do broker restringe.
O corpo da mensagem é apenas dado enviado pelo equipamento.

## 7. Incêndio — limite legal

A detecção de fumaça/incêndio tem que vir de **central de alarme certificada** (NBR 17240),
com saída de contato seco lida como entrada digital. A plataforma **supervisiona e notifica**;
ela não detecta e não substitui o sistema de incêndio do prédio. Vender detecção própria aqui
é risco jurídico.

## 8. Mapeamento Modbus

O endereço de registradores depende do manual de cada equipamento e **não pode ser inventado**.
Ele fica em `devices.metadata` (JSONB), por dispositivo:

```json
{ "slaveId": 1, "register": 0, "scale": 0.001, "capacityLiters": 10000 }
```

Esses valores são apenas ilustrativos. O firmware do gateway precisa ler esse mapeamento;
o cadastro na plataforma, sozinho, não configura nem programa o equipamento.

## 9. Checklist de campo

Antes de sair da instalação, confirme e anote:

- [ ] baud rate, data bits, paridade e stop bits do sensor
- [ ] slave ID de cada equipamento no barramento
- [ ] registrador, tamanho, sinal, unidade e escala de cada leitura
- [ ] terminação de 120 Ω nas duas pontas do barramento RS485
- [ ] altura útil e geometria do reservatório (a curva de volume não é linear em caixa cônica)
- [ ] credencial MQTT do gateway cadastrada no broker
- [ ] `deviceId` de cada sensor cadastrado no painel, no prédio certo

## 10. Testes de aceitação

| # | Teste | Como verificar |
|---|---|---|
| 1 | Sensor responde no RS485 | Leitura Modbus direta no gateway |
| 2 | Gateway converte e publica | `mosquitto_sub` no tópico do prédio |
| 3 | Plataforma autentica o gateway | Conexão aceita no EMQX com a credencial emitida |
| 4 | Ingestão valida e grava | Linha nova em `telemetry` |
| 5 | Painel mostra a leitura | Card do sensor no painel do prédio |
| 6 | Tempo real funciona | Valor muda sem recarregar a página |
| 7 | Regra dispara | Forçar valor fora do limite e ver o alerta nascer |
| 8 | Queda é detectada | Desligar o gateway e ver o status virar OFFLINE |

Os testes 4 a 8 podem ser ensaiados **sem hardware** com `pnpm simulate:hardware`.

## 11. Segurança

- MQTT sobre TLS na porta 8883 em produção; nunca exponha 1883 na internet;
- credencial exclusiva por gateway, evoluindo para certificado por dispositivo;
- autenticação e autorização HTTP do EMQX configuradas no Compose de produção; o arquivo `acl.conf` é uma negação de segurança, não uma lista de permissões por gateway;
- validação Zod antes de persistir;
- `eventId` no formato genérico ou sensor/métrica/timestamp no compacto para idempotência com QoS 1;
- RLS no PostgreSQL isolando os dados por prédio.
