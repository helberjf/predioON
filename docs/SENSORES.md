# Sensores, contratos e simulação

O painel **Sensores e segurança** (`/sensores`) acompanha gás, sinal de alarme da central de incêndio, vazamentos de água e esgoto e temperatura. Água/reservatórios e energia têm painéis próprios. Cada ponto é identificado pelo dispositivo e pelo prédio, permitindo cadastrar mais de um equipamento do mesmo tipo.

Uma leitura `false` significa **sem detecção naquela leitura**. Ausência de dados, sensor desativado, qualidade diferente de `GOOD`, horário inválido/futuro ou leitura com mais de 15 minutos nunca são apresentados como ausência atual de detecção. Os alertas abertos continuam na área de alertas até o tratamento operacional.

## Contrato de telemetria

O gateway publica no tópico `predio/{buildingId}/device/{deviceId}/telemetry` usando o envelope existente:

```json
{
  "schemaVersion": 1,
  "eventId": "evento-unico-do-gateway-0001",
  "buildingId": "bld_001",
  "deviceId": "gas_01",
  "metric": "gas_detected",
  "value": true,
  "quality": "GOOD",
  "timestamp": "2026-09-22T12:00:00.000Z"
}
```

`eventId` deve se manter em retransmissões de uma mesma leitura para deduplicação de MQTT QoS 1. IDs do corpo e tópico precisam coincidir. `timestamp` é o horário da amostra em UTC. Valores são números finitos ou booleanos conforme a métrica; texto `"false"`, `"true"` e números `0`/`1` são recusados para métricas booleanas. O gateway deve converter o contato físico para `true`/`false` antes de publicar.

| Tipo de dispositivo | Métricas | Unidade / valor |
| --- | --- | --- |
| `WATER_LEVEL_SENSOR` | `water_level_percent`, `volume_liters`, `distance_mm` | `%` de 0 a 100; `L` e `mm` não negativos |
| `WATER_METER` | `water_total_m3` | `m³`, acumulador não negativo |
| `ENERGY_METER` | `energy_total_kwh` | `kWh`, acumulador não negativo |
| `PUMP_MONITOR` | `pump_running` | booleano do contato auxiliar |
| `PHASE_MONITOR` | `voltage_l1`, `voltage_l2`, `voltage_l3` | `V`, de 0 a 1000 |
| `PHASE_MONITOR` | `current_l1`, `current_l2`, `current_l3` | `A`, de 0 a 100000; opcionais |
| `PHASE_MONITOR` | `frequency_hz` | `Hz`, de 0 a 100; opcional |
| `TEMPERATURE_SENSOR` | `temperature_c` | `°C`, de −273,15 a 1000 |
| `GAS_SENSOR` | `gas_detected`, `gas_ppm` | booleano; `ppm` de 0 a 1000000, quando disponível |
| `SMOKE_PANEL_RELAY` | `smoke_detected` | booleano do relé de alarme da central |
| `LEAK_SENSOR` | `water_leak_detected` | booleano de vazamento de água |
| `SEWAGE_LEAK_SENSOR` | `sewage_leak_detected` | booleano de vazamento de esgoto |

As unidades são opcionais quando implícitas no contrato. Se enviadas, precisam corresponder exatamente à unidade da tabela. Os limites acima validam o formato e as faixas do contrato; os limites operacionais são configurados nas **Regras de alerta** (`/regras`). Métricas personalizadas continuam aceitas pelo contrato genérico existente.

`leak_detected` continua aceito para sensores antigos de água. Em um ponto, envie apenas a métrica canônica ou a legada por amostra; enviar ambas pode acionar as duas regras de compatibilidade. `smoke_detected` representa o sinal de alarme da central e não informa concentração de fumaça. `gas_detected` vem da lógica do detector; o painel não deduz ausência de gás a partir de uma concentração isolada.

O contrato específico de caixa d'água permanece em `predio/{buildingId}/caixa_agua/{deviceId}/telemetria`, com `nivel_percentual` e os campos opcionais `volume_litros`/`distancia_mm`. Consumo de água usa o hidrômetro acumulado, nunca a diferença do nível do reservatório.

## Cadastro de demonstração e regras

`seedSensors()` complementa o seed básico de `bld_001`/`gw_001` com `energy_01`, `water_meter_01`, `gas_01`, `smoke_01` e `sewage_01`. Os novos dispositivos são marcados como simulados nos metadados e iniciam em provisionamento até receberem telemetria. Nenhum endereço ou mapa Modbus real é inventado.

O seed adiciona os mapeamentos das métricas e regras de subtensão/sobretensão nas três fases, temperatura alta, gás, central de incêndio e vazamentos de água/esgoto. Reexecuções não duplicam dispositivos, mapeamentos ou regras já existentes com o mesmo nome ou condição. Configurações existentes são preservadas. Os limites de demonstração de tensão (180/260 V) e temperatura (45 °C) devem ser ajustados ao projeto do local; o seed não certifica a adequação desses valores à instalação.

## Simulador

Com a infraestrutura, seed e serviço de ingestão em execução:

```powershell
pnpm simulate:hardware --scenario=normal
pnpm simulate:hardware --scenario=gas
```

| Cenário | Comportamento exercitado |
| --- | --- |
| `normal` | Hidrômetro e energia acumulam; nível varia com demanda e reposição; tensões/correntes/frequência variam moderadamente |
| `low-water` | Nível do reservatório até 18% |
| `power-loss` | Subtensão em L1/L2, L3 zerada, bomba desligada e energia acumulada sem avanço |
| `leak` | Detecção de vazamento de água |
| `sewage-leak` | Detecção de vazamento de esgoto, independente da água |
| `gas` | Detector de gás ativo e concentração sintética em torno de 1800 ppm |
| `smoke` | Relé de alarme da central ativo |
| `high-energy` | Carga elétrica cerca de cinco vezes maior |
| `high-water-consumption` | Consumo do hidrômetro cerca de seis vezes maior |
| `pump-overrun` | Bomba permanece ligada, inclusive com reservatório cheio |
| `stuck-sensor` | Nível constante com comunicação ativa; permite investigar valor travado, sem afirmar automaticamente falha a partir disso |
| `gateway-drop` | Gateway publica OFFLINE e deixa de enviar leituras |

O cenário de gás usa valores sintéticos de demonstração e não representa limiar de segurança, tipo de gás ou calibração de equipamento real.

Variáveis opcionais:

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `SIM_BUILDING_ID` / `SIM_GATEWAY_ID` | `bld_001` / `gw_001` | Identidade do ambiente; dispositivos e permissões MQTT devem estar cadastrados nele |
| `SIM_INTERVAL_MS` | `5000` | Intervalo de publicação entre 500 e 300000 ms |
| `SIM_TIME_SCALE` | `1` | Avanço físico de consumo/reposição entre 1 e 3600 vezes |
| `SIM_MQTT_USERNAME` / `SIM_MQTT_PASSWORD` | Credenciais MQTT do ambiente | Conta de publicação do simulador |
| `SIM_MQTT_CLIENT_ID` | ID do gateway | Identificação da conexão |

Exemplo de aceleração para observar mudanças de nível rapidamente:

```powershell
$env:SIM_TIME_SCALE = '60'
pnpm simulate:hardware --scenario=normal
```

Os horários publicados continuam reais, sem amostras no futuro. A aceleração aumenta o avanço dos acumuladores por intervalo, portanto também aumenta as taxas de consumo calculadas pela plataforma. Duração contínua da bomba, janela analítica e cooldowns continuam usando o tempo real; ajuste a configuração de demonstração para testes rápidos. Para valores de consumo comparáveis ao modelo físico, use `SIM_TIME_SCALE=1`.

Os acumuladores reiniciam nos valores iniciais ao reiniciar o processo. Isso exercita o tratamento de reinício/troca de medidor; não é histórico persistido do equipamento. Os cenários são selecionados por processo e a simulação não aciona saídas físicas de portão ou equipamentos.

## Verificação e limites

`services/ingest/test/sensors.test.ts` verifica contratos, rejeição antes da ingestão, valores e unidades, independência das detecções, acumuladores, cenários e apresentação de dados antigos/inválidos. `sensors.integration.test.ts` verifica persistência, qualidade, geração de alertas e deduplicação das cinco métricas de detecção, incluindo a legada, com o banco local preparado.

A simulação valida o fluxo de software. Integração física requer os equipamentos, documentação do fabricante, mapa de entradas/registros, calibração, teste do relé da central e validação no local. Disjuntores e extintores permanecem fora deste escopo.
