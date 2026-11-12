# Estudo de hardware: menor custo total com monitoramento robusto

Revisão de **05/11/2026**. Escopo confirmado: **somente monitoramento**, incluindo caixa
d'água, cisterna, consumo de água e energia, fases, estado da bomba, temperatura,
vazamentos de água/esgoto, gás e sinal da central de incêndio. Portões e vagas não fazem
parte desta compra. O piloto será instalado em um condomínio. Tensão, dimensões,
tubulação, gás e demais dados do local permanecem **para preencher** na
[lista de compras do piloto](COMPRAS_PILOTO.md), que reúne modelos, quantidades,
preços, links, condições e alternativas desta revisão.

**Situação:** seleção técnica e orçamento preliminar; nenhum conjunto foi homologado
fisicamente por este estudo. Documentação de fabricante, preço anunciado e teste de
software não substituem o teste com o equipamento e o firmware que serão instalados.

**Abrangência da pesquisa:** a seleção anterior não esgotava o mercado brasileiro.
A seção 6 foi ampliada com HI Tecnologia, Contemp, Seneca, ICP DAS, FieldLogger e WEG.
O PUSR é uma referência econômica orçada, não um vencedor comprovado de custo ou
confiabilidade no Brasil. Os valores da lista de compras permanecem os pesquisados
em **04/11/2026**; esta ampliação não substitui seus itens por produtos ainda sem
proposta completa equivalente.

**Comunicação e automação (12/11/2026):** a [seção 3](#3-comunicação-dos-sensores-e-automação)
descreve como cada sensor fala com o gateway, o plano do barramento RS485, a cadência de
publicação, o caminho até a plataforma, o mapa dos pontos, o que a automação faz hoje e
o que falta implementar. As seções seguintes foram renumeradas.

## 1. Decisão recomendada

**Validar um piloto PUSR USR-M100-HM-GL + USR-IO8000, com cartão, contador de água,
fonte de procedência, proteção elétrica e nobreak.** O 4G integrado é a primeira
opção para reduzir interrupções dos alertas remotos sem o custo de um roteador
separado. Sua troca de conexão precisa funcionar também quando a internet cai e
o cabo Ethernet continua conectado.

A versão **HM-ETH** custa menos entre as duas variantes PUSR orçadas quando há conexão
alternativa existente ou é aceitável receber os dados somente após a internet
voltar. O armazenamento local e a alimentação de reserva precisam ser aprovados
nas duas versões. O piloto contempla instalação em campo, com preparação e teste
do mesmo conjunto antes da montagem definitiva.

**Revisão econômica de água e vazamentos:** adotar como referência **Teracom TDI340**,
dois **RISCO RK6F cabeados com fonte Mean Well HDR-15-12**, e **Renova UR equipado,
ref. 5132250000068**, quando adequados ao local. A redução de materiais é
**R$ 1.003,43** frente à lista anterior. O TDI340 documenta memória não volátil;
os RISCO oferecem IP67 e detecção após pelo menos 10 s, sem equivalência automática
ao Dwyer IP68. O hidrômetro DN20/Q3 4 m³/h depende do levantamento de vazões e
documentação da variante. A [lista detalhada](COMPRAS_PILOTO.md) registra esses limites,
os modelos alternativos e os links consultados; não há ensaio de durabilidade comparativa.

| Cenário de materiais para as funções do piloto | Referência de planejamento | Condição |
|---|---:|---|
| **M100-HM-GL + IO8000 + contador + SD + sensores + fontes/nobreak + infraestrutura** | **R$ 9.744,01–10.934,01** | Primeiro candidato com 4G integrado; inclui referências ainda pendentes de cotação |
| Mesmo escopo com M100-HM-ETH | R$ 9.062,98–10.252,98 | Economiza R$ 681,03, com a condição de conectividade descrita acima |

**Não são preços fechados do sistema instalado.** O TDI340 a R$ 1.080,91 consta no
catálogo comercial, mas sua disponibilidade/preço exigem confirmação. A fonte de 12 V
informa 45 dias úteis e os RISCO são por encomenda. As duas sondas usam R$ 880 cada
apenas como valor inicial sem cabo completo confirmado, e R$ 1.320–2.510 são provisões
de infraestrutura. Tensão, corrente, diâmetro e instalação podem alterar os valores.
A lista detalhada substitui as
estimativas anteriores de R$ 7,7–8,2 mil com modelos genéricos e preços históricos.

O maior retorno do orçamento está em alimentação, sensores, proteção e recuperação
dos dados. Um CLP mais caro não resolve sozinho esses requisitos. **Altus XP315**
permanece candidato industrial quando ambiente, manutenção ou integração justificarem
o adicional; não há ensaio comparativo para declarar qual conjunto tem menor taxa
de falhas. A compra em escala depende dos testes da seção 8.

Sem conexão alternativa, não há alerta remoto durante a queda da internet. A
plataforma atual também não converte automaticamente todos os eventos antigos em
alertas após a reconexão. Essa diferença precisa constar da entrega operacional.

## 2. O que o kit entrega e como dimensionar

Base de comparação: um condomínio com **uma caixa, uma cisterna, uma bomba, um ponto
de medição de água, um ponto de energia trifásica, um ponto de temperatura, dois pontos
de vazamento e um ponto de gás**, além de central de incêndio existente com interface
compatível. Cobrir todas essas funções não significa cobrir fisicamente todas as áreas
do prédio com um único sensor de cada tipo.

Contratos da plataforma: [SENSORES.md](SENSORES.md) e
[HARDWARE_SOFTWARE.md](HARDWARE_SOFTWARE.md). A bomba é monitorada; as
[automações](AUTOMACOES.md) geram ordens de serviço, sem comando de equipamento. O
caminho de cada sinal e as camadas de automação estão na seção 3.

| Função | Equipamento/interface do kit | Condição para cumprir a função |
|---|---|---|
| Nível da caixa | Transmissor submersível 4–20 mA, AI1 | Definir faixa pela altura útil, materiais, precisão e cabo. 0–5 mca é referência, não padrão universal |
| Nível da cisterna | Segundo transmissor 4–20 mA, AI2 | Calibrar separadamente; volume depende da geometria do reservatório |
| Consumo de água | Hidrômetro pulsado Renova como referência + TDI340 em RS485 | Definir litros/pulso, vazões, diâmetro, tipo elétrico, documentação metrológica e retenção; DN20 não atende automaticamente qualquer condomínio |
| Energia e fases | Multimedidor Modbus | kWh, tensões e, se contratadas, correntes/frequência. Definir versão, ligação e transformadores de corrente necessários |
| Estado da bomba | Contato auxiliar existente | Publicar `pump_running` conforme o contrato atual: estado do contato. Não afirmar vazão a partir dele |
| Temperatura | Transmissor Modbus, XY-MD02 como referência histórica | Confirmar modelo, precisão, endereço, comunicação e adequação ao ambiente |
| Vazamento de água e esgoto | Dois RISCO RK6F, 12 V, NF nos canais 2/3 do TDI340 | Candidatos para derramamento aquoso no piso: validar IP67, atraso de detecção, líquido, limpeza e falhas. Substituir se houver exigência incompatível |
| Gás | Detector para o gás realmente presente, com relé | Calibração, vida útil e alarme local definidos. `gas_ppm` só se o aparelho medir e fornecer esse dado |
| Incêndio | Sinal da central existente | O Prédio ON supervisiona seu sinal; central, detectores e alarmes locais continuam independentes |
| Conferência do nível | Quatro boias independentes, alta e baixa em cada reservatório | Comparação com o nível analógico exige mapeamento e regra de divergência; não está pronta só por conectar as boias |
| Falta de alimentação da instalação | Contato de diagnóstico compatível, independente do gateway alimentado pelo nobreak | Diferenciar falta de rede de perda de comunicação do medidor; interface e regra a implementar/validar |
| Falha de comunicação e histórico | MQTT, armazenamento local e supervisão na plataforma | Separar gateway conectado, sensor respondendo e leitura atual válida |

**Dimensionamentos que podem mudar o preço:** o DTSU666 de ligação direta até 80 A e
o hidrômetro de 3/4" eram referências do estudo anterior. Não servem automaticamente
para a entrada de qualquer condomínio. Exigir o modelo exato, mapa Modbus, corrente,
vazão e diâmetro aplicáveis antes da compra. Mais pontos de gás, vazamento, bombas ou
reservatórios aumentam sensores, cabeamento e eventualmente entradas/gateways.

Corrente no motor ajuda a diagnosticar carga, mas também não comprova entrega de água.
Confirmação de bombeamento exige medição apropriada de vazão/pressão e integração
adicional, caso seja contratada; não está embutida no preço do contato auxiliar.

### Entradas do M100 + IO8000

O conjunto oferece 10 entradas digitais e 2 analógicas. Uma alocação de projeto é:

| Entradas | Alocação |
|---|---|
| AI1 e AI2 | Caixa e cisterna: 2 de 2 utilizadas |
| Oito DI | Bomba, incêndio, gás, quatro boias e falta da rede elétrica |
| Duas DI restantes, fisicamente no IO8000 | Presença de 12 V após a proteção de cada ramal RISCO no quadro; entrada de 9–36 V, conforme manual |
| TDI340, canal 1 | Pulsos do hidrômetro. Não utilizar leitura periódica de estados pelo gateway para contar pulsos |
| TDI340, canais 2 e 3 | Contatos secos NF dos RISCO de água e esgoto; entrada de no máximo 5,5 V, sem tensão externa |
| TDI340, canal 4 | Reserva para contato seco/diagnóstico eletricamente compatível |
| RS485 | Medidor de energia, temperatura, contador e expansões conforme topologia do fabricante |

As dez DI principais ficam ocupadas e sobra um canal no TDI340. A numeração acima é
lógica, não endereço de registrador. Confirmar terminais, tensão,
polaridade e mapa no equipamento real. Um contato seco simples não detecta automaticamente
cabo rompido ou sensor travado; usar diagnóstico do fabricante ou supervisão adicional
quando necessário. Ausência de leitura não pode virar "sem vazamento" ou "sem gás".

O NF do RISCO abre com água ou rompimento do circuito de sinal; não identifica sozinho
a causa. Sua especificação limita contato e alimentação a 16 V: **não ligar ao circuito
de 24 V**. As DI de diagnóstico verificam os ramais de 12 V no quadro, sem comprovar
alimentação no sensor. Testar falhas de campo e contratar supervisão adicional se
necessária. Não afirmar imunidade a curto, cabo de alimentação rompido ou sensor travado.

## 3. Comunicação dos sensores e automação

Revisão de **12/11/2026**, conferida com o código em `22f7245e`. Descreve a arquitetura
proposta para o piloto e o que a plataforma já faz. Itens marcados **a implementar** não
existem hoje; nomes de dispositivos, endereços e cadências são **propostas** a confirmar
com os manuais e o firmware entregues.

**Resumo.** Os sensores não conversam entre si. Cada um fala apenas com o gateway, por um
de quatro meios físicos: laço 4–20 mA, contato seco, pulsos registrados por um contador
ou barramento RS485 Modbus RTU. O gateway é o único mestre: lê todos os pontos, converte
em leituras com unidade e horário e publica por MQTT sobre TLS. A relação entre as
medições, como comparar boia e nível, acontece na plataforma, que gera alertas e, por
automação, ordens de serviço. **Nenhum equipamento é comandado pela plataforma.** Bomba,
detector de gás e central de incêndio mantêm seus comandos e alarmes locais.

### 3.1 Caminho de uma leitura

```text
CAMPO                                QUADRO DO GATEWAY (após o nobreak)
Sonda da caixa     4–20 mA ────────► AI1 ─┐
Sonda da cisterna  4–20 mA ────────► AI2 ─┤
Bomba, gás, incêndio, 4 boias,            │
falta de rede      contato seco ──► DI  ──┤
Ramais 12 V RISCO  presença de tensão ► DI┤   USR-M100 (+ IO8000)
                                          ├── mestre único do RS485
Hidrômetro (pulsos) ─► TDI340 canal 1 ┐   │
RISCO água/esgoto (NF) ► canais 2 e 3 ├─ RS485 Modbus RTU (barramento em linha)
Multimedidor de energia ──────────────┤
Transmissor de temperatura ───────────┘
                │
                │ MQTT sobre TLS, porta 8883 — Ethernet; 4G no HM-GL
                ▼
NUVEM PRÉDIO ON
EMQX ─► ingestão ─► TimescaleDB ─► API ─► painéis em tempo real (SSE)
 │          │
 │          └─► regras, consumo e supervisão ─► alerta + evento (mesma transação)
 │                                                  ├─► webhook HTTPS (HIGH/CRITICAL)
 │                                                  └─► automação ─► ordem de serviço
 └─ autenticação e autorização por gateway consultadas na API
```

### 3.2 Camada física: como cada sensor fala com o gateway

| Meio | Pontos do piloto | Como funciona | Regras de instalação | Como uma falha deve aparecer |
|---|---|---|---|---|
| **Laço 4–20 mA** | Caixa e cisterna | O transmissor, alimentado pela fonte de 24 V, ajusta a corrente conforme a coluna d'água: 4 mA no início da faixa, 20 mA no fim. A AI do M100 mede a corrente | Par trançado blindado, blindagem aterrada só no quadro; proteger o tubo de respiro do cabo da sonda; sem emendas dentro do reservatório | Corrente abaixo de ~3,8 mA ou acima de ~20,5 mA indica laço aberto, curto ou sonda defeituosa (NAMUR NE 43 como referência; confirmar no transmissor). Publicar qualidade `BAD`, **nunca 0%** |
| **Contato seco → DI** | Bomba, gás, incêndio, quatro boias, falta de rede e dois diagnósticos de 12 V | O gateway lê aberto/fechado e converte para `true`/`false` conforme o mapa do ponto | Contato livre de tensão ou interface compatível com a faixa da DI; não misturar tensões do quadro de comando; registrar se cada contato é NA ou NF | Contato simples não detecta cabo rompido. Preferir NF nos alarmes, para que cabo cortado apareça como alarme. As DI orçadas não documentam supervisão de linha; tratar como limitação |
| **Pulsos → contador** | Hidrômetro | O emissor fecha um contato a cada volume fixo; o TDI340 conta em memória não volátil e o gateway lê o total | Cabo curto e blindado, longe de cabos de força; filtro de rebote configurado; litros/pulso anotados | Total parado não prova defeito. Falha do contador aparece como timeout Modbus, que invalida a leitura |
| **RS485 Modbus RTU** | TDI340, multimedidor de energia e temperatura | Barramento de dois fios mais referência. O gateway pergunta a cada escravo (função 03) e só ele responde; ninguém fala sem ser perguntado | Topologia em linha, sem estrela nem derivações longas; 120 Ω nas duas pontas; polarização em um único ponto; par trançado blindado; mesmo baud e paridade em todos; endereço único. O padrão admite até 1.200 m e 32 cargas, sem garantir isso para qualquer cabo | Timeout ou CRC inválido marca **só aquele escravo** como `BAD`; os demais continuam sendo lidos |

**Plano proposto do barramento RS485**, partindo de 9600 bit/s, 8 bits, sem paridade e
1 stop (8N1) se todos os equipamentos entregues aceitarem:

| Endereço | Equipamento | O que o gateway lê | Cadência de leitura |
|---:|---|---|---|
| 1 | TDI340 | Contador do canal 1 (uint32 em PDU 210–211) e estados dos canais 2 e 3 (PDU 202 e 203) | 5 s, por causa dos vazamentos |
| 2 | Multimedidor de energia | kWh acumulado, tensões L1–L3 e, se contratadas, correntes e frequência | 60 s |
| 3 | Transmissor de temperatura | °C | 60 s |

Em 9600 bit/s, cada pergunta e resposta curta leva poucas dezenas de milissegundos; essa
cadência ocupa uma fração pequena do barramento e deixa margem para novos escravos.

### 3.3 Cadência de publicação e por que ela importa

| Grupo | Leitura no gateway | Publicação | Motivo |
|---|---|---|---|
| Alarmes (vazamento, gás, incêndio, boias, falta de rede, 12 V) | 1 s nas DI; 5 s no TDI340 | Na mudança, se o firmware permitir, **e** a cada 60 s | Alerta rápido. O reenvio periódico é obrigatório: dispositivo sem leitura há 300 s vira `OFFLINE` com alerta de comunicação |
| Nível da caixa e da cisterna | 10 s | 60 s | Nível muda devagar; 60 s basta para alertas e gráficos |
| Hidrômetro e energia | 60 s | 60 s | Consumo só é contado entre leituras com intervalo de até 300 s (`max_gap_seconds` padrão) |
| Bomba | 1 s | Na mudança e a cada 60 s | O tempo contínuo de funcionamento é calculado entre leituras |
| Temperatura | 60 s | 60 s | Grandeza lenta |
| Status do gateway | — | `ONLINE` retido na conexão; Last Will `OFFLINE` retido; keepalive MQTT de 30 a 60 s | A plataforma marca o gateway `OFFLINE` após 120 s sem mensagem; a varredura roda a cada 30 s |

**Volume de dados, ordem de grandeza a medir no piloto:** cerca de 25 métricas por minuto
resultam em ~36 mil mensagens por dia. Com uma mensagem por métrica, de ~0,5 kB com
cabeçalhos de MQTT, TLS e TCP, são ~18 MB por dia, ~540 MB por mês. Um relatório agrupado
por minuto, com todas as métricas, fica perto de ~3 MB por dia. A diferença pesa no plano
4G quando a conexão celular é a principal ou fica ativa por muito tempo.

### 3.4 Gateway → plataforma

**Conexão.** MQTT sobre TLS na porta 8883, com o gateway validando o certificado do
broker. Usuário e senha são exclusivos do gateway, emitidos em **Gateways → Gerar
credencial**. O EMQX consulta a API (`/internal/mqtt/authn` e `/internal/mqtt/authz`)
e só deixa o gateway publicar nos tópicos do próprio prédio, do próprio gateway e dos
dispositivos vinculados a ele. O relógio do gateway deve ser sincronizado por NTP:
amostra com horário mais de 60 s no futuro é recusada.

**Tópicos aceitos hoje:**

```text
predio/{buildingId}/device/{deviceId}/telemetry      envelope genérico, uma métrica por mensagem
predio/{buildingId}/caixa_agua/{deviceId}/telemetria contrato compacto da caixa
predio/{buildingId}/gateway/{gatewayId}/status       ONLINE/OFFLINE, retido
```

**Regras de publicação.** Telemetria em QoS 1, sem retenção. `eventId` estável para a mesma
leitura, inclusive no reenvio. `timestamp` é o horário da amostra em UTC. Booleanos vão
como `true`/`false` JSON; `0`, `1` e texto são recusados. Qualidade é `GOOD`,
`UNCERTAIN` ou `BAD`.

**O que a ingestão faz com cada mensagem:**

1. Valida o schema e confere se `buildingId`/`deviceId` do corpo são os do tópico.
2. Confere se o dispositivo está cadastrado e habilitado naquele prédio e se o gateway
   dele está habilitado. Fora disso, descarta e conta a rejeição.
3. Grava o recibo do `eventId` e a leitura na mesma transação. O mesmo `eventId` com o
   mesmo conteúdo não grava de novo; com conteúdo diferente, conta conflito e não tem efeito.
4. Na mesma transação, calcula consumo, avalia regras e atualiza o "último sinal" do
   dispositivo e do gateway.
5. Só depois do commit confirma o recebimento (PUBACK) ao broker. Se o banco falhar, a
   mensagem não é confirmada e o broker entrega de novo. A sessão é durável: leituras
   publicadas com a ingestão parada são entregues quando ela volta.
6. Publica a leitura e os alertas novos para os painéis em tempo real.

Mensagem retida reenviada pelo broker entra só como histórico: não gera alerta, consumo
nem sinal de vida.

**Formato do M100: decisão pendente.** A ingestão não aceita o relatório agrupado do M100.
Há dois caminhos:

| Caminho | Como | Quando serve |
|---|---|---|
| **A — configurar o M100** | Publicar uma mensagem por métrica, já no envelope genérico | Só se o firmware gerar `eventId` estável por leitura, horário UTC da amostra e um tópico por dispositivo |
| **B — adaptador na ingestão** (recomendado) | Novo tópico `predio/{buildingId}/gateway/{gatewayId}/report`; a ingestão divide o relatório em leituras usando o mapa de cada ponto em `devices.metadata` | Mantém o firmware simples, centraliza escalas e conversões na plataforma e reduz o tráfego 4G |

A recomendação de B depende de capturar o JSON real do equipamento. Ela exige atualizar
contrato, autorização no broker/API, assinatura MQTT e normalização (seção 7).

### 3.5 Mapa dos pontos do piloto

Os `deviceId` são sugestões. Os tipos que já existem na plataforma têm painel e regras
padrão. Os marcados **a implementar** são aceitos como tipo e métrica personalizados, sem
tela nem regra pronta.

| Ponto | Entrada física | `deviceId` sugerido | Tipo | Métrica | Conversão até a métrica |
|---|---|---|---|---|---|
| Nível da caixa | AI1 | `caixa_01` | `WATER_LEVEL_SENSOR` | `water_level_percent`, `volume_liters` | mA → coluna d'água → % da altura útil; volume pela geometria. Fora de 4–20 mA → `BAD` |
| Nível da cisterna | AI2 | `cisterna_01` | `WATER_LEVEL_SENSOR` | idem | Calibração própria |
| Consumo de água | TDI340 canal 1 | `hidrometro_01` | `WATER_METER` | `water_total_m3` | uint32 × litros/pulso ÷ 1000 + referência do mostrador |
| Vazamento de água | TDI340 canal 2 | `vaz_agua_01` | `LEAK_SENSOR` | `water_leak_detected` | 1 (aberto) → `true`; 0 → `false` só se o ramal de 12 V estiver presente |
| Vazamento de esgoto | TDI340 canal 3 | `vaz_esgoto_01` | `SEWAGE_LEAK_SENSOR` | `sewage_leak_detected` | idem |
| Energia | Modbus, endereço 2 | `energia_01` | `ENERGY_METER` | `energy_total_kwh` | Escala do mapa do medidor |
| Fases | mesmo medidor | `fases_01` | `PHASE_MONITOR` | `voltage_l1..l3`; opcionais `current_l1..l3`, `frequency_hz` | Um medidor físico vira dois dispositivos lógicos, como no seed, porque painéis e funcionalidades seguem o tipo |
| Temperatura | Modbus, endereço 3 | `temp_01` | `TEMPERATURE_SENSOR` | `temperature_c` | Escala do mapa |
| Bomba | DI | `bomba_01` | `PUMP_MONITOR` | `pump_running` | Contato do contator fechado → `true` |
| Gás | DI | `gas_01` | `GAS_SENSOR` | `gas_detected` | Relé de alarme do detector |
| Incêndio | DI | `incendio_01` | `SMOKE_PANEL_RELAY` | `smoke_detected` | Relé de alarme da central |
| Quatro boias | DI | `boia_caixa_alta`, `boia_caixa_baixa`, `boia_cisterna_alta`, `boia_cisterna_baixa` | `FLOAT_SWITCH` — a implementar | `float_active` | Boia acionada → `true` |
| Falta de rede | DI | `rede_01` | `MAINS_MONITOR` — a implementar | `mains_power_ok` | Rede presente → `true` |
| Ramais de 12 V | DI | `ramal12v_agua`, `ramal12v_esgoto` | `SUPPLY_MONITOR` — a implementar | `supply_ok` | Tensão presente → `true` |

Cada dispositivo guarda em `devices.metadata` o mapa do seu ponto, por exemplo endereço
Modbus, registrador, escala, faixa em mA ou NA/NF. O cadastro na plataforma não programa
o gateway: o mesmo mapa precisa ser configurado no M100 ou no adaptador.

### 3.6 Automação: o que acontece depois que a leitura chega

| Camada | Onde roda | O que faz | Estado |
|---|---|---|---|
| **0. Proteção e comando local** | Quadro da bomba, detector de gás, central de incêndio | Liga e desliga a bomba pela boia ou comando próprio; alarme sonoro local; válvula de gás, se existir | Já existe no prédio. O Prédio ON não interfere |
| **1. Regras de alerta** | Ingestão, na transação da leitura | Limite por métrica (`LT`, `LTE`, `GT`, `GTE`, `EQ`, `NEQ`), no prédio ou num dispositivo; severidade; pausa contra oscilação. Booleano vira 1/0, por exemplo `water_leak_detected EQ 1` | Pronto. As 16 regras padrão da 066 nascem desativadas; revisar limites antes de ativar |
| **2. Consumo e bomba** | Ingestão, por perfil de monitoramento | Limite diário de m³ ou kWh, custo diário pela tarifa, tempo contínuo da bomba e desvio contra até 28 dias de histórico (anomalia exige `AI_ANALYSIS`) | Pronto; depende de leituras com até 5 min de intervalo |
| **3. Supervisão de comunicação** | Ingestão: varredura a cada 30 s e Last Will | Gateway sem mensagem há 120 s, ou Last Will recebido, vira `OFFLINE` com alerta `COMMUNICATION_LOST` (HIGH). Dispositivo sem leitura há 300 s, idem | Pronto |
| **4. Entrega do alerta** | Outbox no banco + serviço `notifications` | Alerta e evento gravados juntos. Painel em tempo real. HIGH/CRITICAL vão para o webhook HTTPS, com novas tentativas | Pronto. Não há e-mail de alerta: o Resend é usado só em recuperação de acesso e convites. Push não será feito |
| **5. Automações** | Gatilho no banco, na transação do alerta | Alerta novo abre ordem de serviço com título, prioridade, equipe e ativo; pausa, versões e simulação nos últimos 30 dias. Ou, a cada N dias, abre ordem preventiva (tarefa do TimescaleDB a cada 5 min) | Pronto, com uma única ação: abrir ordem de serviço |
| **6. Comando de equipamento** | — | Não existe, por decisão. Automação não liga bomba nem fecha válvula. O único comando físico do sistema é abrir portão, pedido por pessoa autorizada no módulo de acessos | Fora do escopo desta compra |

**Frescor.** Regras de telemetria e alertas de consumo ignoram leituras com mais de 5 min:
o histórico reenviado depois de uma queda não dispara uma rajada de alertas antigos. O
painel de sensores mostra leitura com mais de 15 min como "estado atual desconhecido" e
qualidade diferente de `GOOD` como "leitura não validada". Leitura `BAD` é gravada, mas
não dispara regra nem conta consumo.

**Por que não comandar equipamentos pela nuvem.** Se um dia for necessário, por exemplo,
fechar uma válvula solenoide ao detectar vazamento ou desligar a bomba sem água na
cisterna, essa lógica deve ficar **no local**: no gateway, num CLP ou num relé com
intertravamento e comando manual de emergência. A nuvem depende da internet, só age
sobre leituras recentes e não tem caminho de comando para esses equipamentos. Ela
continua supervisionando, registrando e avisando.

### 3.7 Exemplos ponta a ponta

**Vazamento de água.** A água chega ao piso e, após pelo menos 10 s, o RISCO abre o
contato. Na leitura seguinte, em até 5 s, o registrador 202 do TDI340 passa a 1. O
gateway publica `water_leak_detected: true` em
`predio/{buildingId}/device/vaz_agua_01/telemetry`. A ingestão grava e a regra de
vazamento cria o alerta. O painel atualiza em segundos, o webhook é chamado e a
automação "vazamento → manutenção" abre a ordem de serviço. Tempo total esperado: ~10 s
do sensor + até 5 s de leitura + segundos de rede, **a medir** no teste "Alarmes e
estados" da seção 8. Se o ramal de 12 V cair junto, o correto é indicar "circuito aberto
ou sem alimentação", não "vazamento confirmado": isso depende de regra composta **a
implementar**.

**Caixa baixando.** A sonda informa a coluna d'água; o gateway converte para % e publica
a cada 60 s. As regras padrão de nível baixo e crítico geram alertas com severidades
diferentes, e a pausa evita repetição enquanto o nível oscila perto do limite.

**Bomba ligada demais.** `pump_running` permanece `true`; quando o ciclo contínuo passa
do limite do perfil, nasce `PUMP_CONTINUOUS_LIMIT`. "Bomba ligada com boia alta
acionada" exige regra composta **a implementar**.

**Queda da internet.** No HM-GL, o gateway passa para o 4G e continua publicando. No
HM-ETH, ou sem 4G, as leituras ficam no cartão SD; o broker percebe a desconexão pelo
keepalive, publica o Last Will e a plataforma abre `COMMUNICATION_LOST`. Na volta, o
histórico é reenviado com os horários originais e gravado, sem alertas para leituras
antigas. Um vazamento que continua ativo gera alerta na primeira leitura atual. Um evento
que começou e terminou durante a queda fica apenas no histórico. O consumo de leituras
reenviadas fora de ordem ainda não é recomposto (seção 7).

**Falta de energia no prédio.** O nobreak mantém gateway, sensores e rede. A DI de falta
de rede publica `mains_power_ok: false`, que precisa de regra **a implementar**, e a
bomba aparece desligada. Esgotada a bateria, o gateway cai e o Last Will indica perda de
comunicação, sem identificar sozinho a causa.

### 3.8 Ordem de configuração no piloto

1. Na plataforma: cadastrar o gateway e gerar a credencial MQTT.
2. Cadastrar os dispositivos da seção 3.5, vinculados ao gateway, com o mapa de cada
   ponto em `devices.metadata`.
3. No M100: broker com TLS e CA, credencial, `ONLINE` retido, Last Will `OFFLINE` retido,
   keepalive, NTP, cache em SD **habilitado** (vem desativado), leituras Modbus e
   cadências da seção 3.3.
4. Conferir cada ponto: valor físico conhecido → leitura no gateway → leitura no painel.
5. Revisar os limites e ativar as regras padrão; configurar os perfis de consumo de água,
   energia e bomba.
6. Criar as automações de alerta → ordem de serviço e as preventivas.
7. Executar os testes da seção 8, incluindo latência dos alarmes e tráfego 4G medido.

### 3.9 O que falta para fechar comunicação e automação

| # | Entrega | Por quê |
|---:|---|---|
| 1 | Capturar o JSON real do M100 e decidir entre A e B; implementar o adaptador se for B | Sem isso, nenhuma leitura do equipamento real entra na plataforma |
| 2 | Traduzir timeout Modbus, CRC inválido, corrente fora de 4–20 mA e falta de 12 V em qualidade `BAD`/`UNCERTAIN` | Falha nunca pode virar zero, "seco" ou "normal" |
| 3 | Tipos, métricas, telas e regras de boias, falta de rede e ramais de 12 V | Hoje são aceitos como dados personalizados, sem painel nem alerta pronto |
| 4 | Regras compostas e com duração | Cada regra olha uma métrica isolada. Faltam "A e B", "persistir por N s" e divergência boia × nível |
| 5 | Recompor consumo com reenvio fora de ordem | Leituras anteriores à última processada são ignoradas no cálculo |
| 6 | Alerta por e-mail via Resend, se o síndico precisar de canal sem webhook | Hoje o alerta chega ao painel e ao webhook |
| 7 | Medir latência dos alarmes e tráfego 4G no piloto | As cadências e volumes desta seção são estimativas |

## 4. Orçamento comparável e rastreável

A [lista de compras](COMPRAS_PILOTO.md) é a referência comercial desta revisão.
Ela distingue **A — anúncio consultado**, **R — referência sem oferta disponível**,
**C — cotação pendente** e **P — provisão estimada**. Preços anunciados não equivalem
a reserva de estoque, adequação da versão ao local ou proposta de instalação.

### 4.1 Composição do cenário com 4G

| Parcela | Valor em reais | Condição |
|---|---:|---|
| Anúncios de gateway GL, IO, SD, fontes 24/12 V, nobreak, sensores definidos, boias, hidrômetro e quadro | 5.583,10 | Modelos e condições na lista; exclui sondas e contador |
| Teracom TDI340 novo | 1.080,91 | Preço do catálogo; confirmar fornecimento e firmware |
| Duas sondas Megga MGG-TNH-SUB | 1.760,00 | Cenário com valor inicial de 880 cada; faixa/cabo/materiais ainda a cotar |
| Infraestrutura e interfaces de diagnóstico | 1.320–2.510 | Provisões detalhadas, não kit cotado |
| **Total do cenário** | **9.744,01–10.934,01** | **Não é teto nem orçamento instalado** |

O orçamento real de materiais é **R$ 5.583,10 + TDI340 recotado + duas sondas
completas cotadas + infraestrutura cotada + diferenças das versões necessárias**.
O custo final inclui ainda frete, instalação, integração, comissionamento e adequações.
Mais sensores ou percursos de cabo aumentam a conta; um ponto de gás não cobre por
definição todos os ambientes do condomínio.

A redução de referência se divide em **R$ 711,01** nos dois sensores de vazamento,
já incluindo a fonte de 12 V, **R$ 63,32** no contador e **R$ 229,10** no hidrômetro.
Conexões hidráulicas, instalação e manutenção podem mudar a economia final. Os demais
itens conservaram as referências da revisão desta data; esta rodada priorizou água
e vazamentos.

### 4.2 Continuidade, diagnóstico e alternativas

O HM-GL anunciado a R$ 1.845,45 custa R$ 681,03 a mais que o HM-ETH a R$ 1.164,42.
É a alternativa celular a verificar antes de somar um roteador 4G separado. Comparar
bandas, unidade comercial, documentação aplicável e teste de troca de conexão.

O sinal da central pressupõe interface compatível disponível: um módulo adicional
deve ser cotado. O contato auxiliar da bomba também depende do contator instalado.
**Medir fases não substitui proteção elétrica da bomba.** O contato DC OK da fonte,
quando alimentada por nobreak, não identifica sozinho a falta da rede; foi prevista
uma interface separada de diagnóstico.

Alimentar pelo nobreak o gateway, módulos, contador, sensores que dependem da fonte,
e toda a rede necessária ao trajeto, incluindo ONT/modem e switch quando utilizados.
Meta inicial: **60 minutos medidos com a carga real**. Adequar o nobreak se não atender;
VA não informa autonomia. Não ligar motores ao nobreak do monitoramento.

A fonte MDR-60-24 de 2,5 A depende do balanço de cargas, partida/transmissão celular
e temperatura. A HDR-15-12 de 12 V/1,25 A alimenta os dois RISCO e também fica após
o nobreak, com ramais protegidos e diagnóstico de presença de tensão. Ela não substitui
a fonte de 24 V. O quadro deve acomodar os equipamentos e dissipar seu calor. Não se
presume que o nobreak ou a bateria caibam no quadro fechado.

### 4.3 Custo total em três anos

Para cada proposta tecnicamente aprovada, preencher:

> Custo total = materiais adequados ao local + frete + montagem/instalação/comissionamento
> + desenvolvimento e homologação rateados pelo número de instalações
> + 36 × custos mensais atribuíveis + manutenção e reposições previstas + visitas técnicas.

Mensalidades incluem conexão móvel, hospedagem/backup e serviços de notificação/gestão
utilizados. Software compartilhado não deve ser cobrado integralmente em cada prédio
nem tratado como gratuito no piloto. Não estimar taxas de falha sem dados.

**Escolher o menor custo total entre os conjuntos que cumpram os requisitos.**
O quadro de preenchimento do custo instalado está na seção 4 da lista de compras.

## 5. Onde reduzir custo sem retirar funções

1. **Reaproveitar equipamentos existentes compatíveis.** Levantar medidor Modbus,
   hidrômetro com saída utilizável, contato auxiliar, central de incêndio, nobreak com
   capacidade disponível, fonte e infraestrutura. Não contabilizar economia antes de
   verificar disponibilidade, estado, interface e autonomia.
2. **Reduzir água e vazamentos com interfaces documentadas.** Dois RISCO + fonte
   custam R$ 743,25; usar somente onde IP67, atraso de pelo menos 10 s e manutenção
   semanal atendam. O Renova UR equipado custa R$ 168,90, condicionado à vazão,
   dimensões e documentação. O MR4 multijato de 190 mm custa mais R$ 25; o emissor
   V4 de R$ 81 pode bastar se já houver Colibri pré-equipado compatível. Esses valores
   não autorizam substituir o hidrômetro sem levantamento do local.
3. **Comparar hidrômetro com totalizador Modbus nativo.** Renova + TDI340 somam
   R$ 1.249,81, com fornecimento do contador a confirmar. Um medidor de dimensão
   equivalente, com total persistente e interface incluída, pode reduzir peças.
   Porém, o TDI340 também recebe os dois RISCO: incluir interfaces que reponham essa
   função antes de calcular economia. Não confundir RS485 com garantia de Modbus.
4. **Avaliar NOVUS DigiRail IoT ETH na mesma rodada de cotação.** Há anúncio de
   [R$ 2.600, ou R$ 2.470 à vista](https://www.nobrebrasil.com/automacao-industrial).
   O modelo reúne contagem de pulsos e aquisição, podendo retirar o contador separado.
   Porém, suas 6 DI, 2 AI e 8 canais remotos não comprovam cobertura de todo o kit,
   agora com quatro boias.
   Dimensionar a expansão digital, todas as métricas e o histórico antes de calcular
   economia. Não recomendar um segundo gateway apenas para contornar limite sem comparar o custo.
5. **Não comprar CLP nem saída analógica sem necessidade.** Manter o XP315 como
   alternativa, sem pagar automaticamente pelo XP325. Não comprar contator novo para
   uma bomba que será apenas monitorada.
6. **Padronizar após o piloto.** Uma configuração reproduzível, mapa de registros,
   firmware fixado, backup e instruções de troca reduzem custo operacional. Material
   usado sem procedência e sensores sem modelo definido não são referência para um kit robusto.

## 6. Comparação técnica sem notas artificiais

| Alternativa | Evidência disponível | Pendência decisiva | Papel na decisão |
|---|---|---|---|
| M100-HM-GL + IO8000 | Manual documenta MQTT/TLS, cache em SD e prioridade de rede; expansão digital documentada | JSON real, persistência, horário original, reenvio ordenado e troca de conexão | Primeiro candidato econômico com continuidade de comunicação |
| M300-GL + IO8000 | Fabricante anuncia Node-RED, armazenamento e conectividade celular | Demonstrar durabilidade da fila, TLS, variante celular e retomada; mais recursos não significam menos falhas | Candidato quando integração/4G justificarem |
| NOVUS DigiRail IoT ETH | Manual documenta pulsos, MQTT, canais remotos e capacidade do buffer | Cobertura de entradas/métricas e autonomia do histórico na configuração completa | Concorrente a cotar, não substituto já aprovado |
| Teltonika TRB246 + módulos | Boa documentação de conectividade e envio de dados | Suporte discutiu banco Modbus em RAM; confirmar retenção após falta de energia na versão escolhida | Alternativa de comunicação, sem presumir fila persistente |
| Altus XP315 | Recursos industriais, entradas, contagem e MQTT/TLS documentados | Programa, fila persistente, sincronização e recuperação ainda precisam ser entregues | Alternativa industrial, com custo maior |

No NOVUS, energia acumulada, três tensões e temperatura usam cinco canais remotos
se cada grandeza ocupar um canal. Dez estados digitais mais um pulso excedem suas
seis DI: faltariam cinco estados na expansão. Esse mapeamento simples exigiria dez
canais remotos, acima dos oito disponíveis, mesmo sem as correntes opcionais.
Essa conta ainda não inclui os dois diagnósticos de 12 V da proposta com RISCO;
qualquer substituição deve refazer o mapa completo e conferir a tensão dos contatos.
Empacotamento de bits ou outra arquitetura só contam como solução após validar mapa,
módulo e interpretação dos dados. Não retirar medições silenciosamente.

O manual informa 1.824 registros com seis DI e duas AI; a um minuto, são 30,4 h,
sem somar canais remotos/eventos. Não comprova 72 h de histórico para este piloto.
As interfaces não isoladas e a cadência alternativa de registro também precisam
entrar na avaliação. A [lista de compras](COMPRAS_PILOTO.md) detalha as condições.

### 6.1 Outras opções comercializadas no Brasil

**Há alternativas nacionais e importadas com canal de venda brasileiro.** Isso não
significa estoque imediato nem que todas tenham o melhor custo para este prédio.
Os modelos abaixo entram na comparação técnica; os preços sob cotação não foram
substituídos por valores estrangeiros convertidos ou estimativas sem fornecedor.

| Alternativa adicional | O que a documentação sustenta | O que falta para comparar com o piloto |
|---|---|---|
| **[HI Tecnologia NEON 5][mercado-neon] + módulos de I/O** | Fabricante nacional; até dois módulos internos, expansão remota e MQTT. Há variantes de comunicação Ethernet, RS485 e 4G | Cotar composição exata e coexistência das interfaces; selecionar AI 4–20 mA, DI e contador. Entregar aplicação, fila persistente, reenvio e comprovar TLS no equipamento, não apenas no portal |
| **[Contemp X502][mercado-contemp] + módulos Modbus** | Fornecedor nacional; publica em broker MQTT de terceiros, oferece versão Ethernet + 4G e parametrização de fábrica. Duas DI isoladas | Precisa de AI, DI e contagem adicionais. O manual rev. 0 não especifica TLS nem funcionamento de fila/reenvio offline; exigir comprovação. DI de 24 V não recebe diretamente o contato RISCO limitado a 16 V |
| **[Seneca R-KEY-LT-C / Z-KEY-C][mercado-seneca-ficha] + módulos Modbus** | Ficha especifica MQTTs, TLS 1.2, certificados X.509, até 300 tags e cache de aproximadamente 59 mil amostras. Há [canal brasileiro LRI][mercado-seneca-br] | Não inclui as entradas dos sensores nem 4G. Cotar módulos, contador e conexão alternativa; medir retenção após corte, formato e reenvio. Número de amostras não comprova sozinho 72 h para todas as métricas |
| **[ICP DAS WISE-5231][mercado-icpdas] + I/O** | MQTT com SSL, regras configuráveis, registro em microSD de 32 GB, RS485 COM4 isolada em 2.500 VDC e faixa de −25 a 75 °C. [Oferta sob consulta no Brasil][mercado-icpdas-br] | Cotar placas/módulos e 4G se necessário. Registro em arquivo e publicação MQTT são recursos distintos: demonstrar recuperação ordenada no Prédio ON e retenção dos pulsos |
| **[NOVUS FieldLogger, versão MQTT][mercado-fieldlogger] + expansão/ponte segura** | O manual V1.9x documenta 8 AI, 8 I/O digitais e armazenamento interno com envio posterior dos dados | O MQTT documentado **não tem TLS** e dados do SD não são enviados por MQTT. Precisa de solução segura adicional para a nuvem e de mais DI; não tratar como troca direta do M100 |
| **[WEG PLC410][mercado-weg-manual] + módulos** | CLP industrial com CODESYS, 8 DI/8 DO, contadores rápidos e expansão analógica; MQTT documentado | [Anúncio de R$ 6.800][mercado-weg-preco] para a CPU, SKU 16974024, consultado em 05/11. Somar AI/DI necessárias, comunicação alternativa, armazenamento e desenvolvimento. Não é o menor investimento nessa oferta |

**HI Tecnologia:** o [manual NEON 5][mercado-neon-manual], seção 11, descreve sistema
de arquivos em SD operado por blocos de programação. Isso permite desenvolver o
histórico, mas não significa fila pronta ou MQTT seguro homologado. A versão
[RION 5][mercado-rion] também merece cotação para conjuntos menores ou como expansão;
seu único módulo de I/O não deve ser confundido com cobertura automática do piloto.
Selecionar gerações atuais, evitando misturar recursos de NEON/RION antigos.

**Contemp:** a parametrização de fábrica pode reduzir horas de integração, uma
hipótese de economia a confirmar na proposta. Pedir amostra real do relatório,
configuração de broker próprio, exportação/backup e procedimento de troca. Não
contabilizar a licença Contemp Cloud como obrigatória para uso de broker terceiro;
o fabricante a apresenta separadamente. No [manual X502][mercado-contemp-manual],
memória interna declarada não define capacidade de fila de telemetria.

**FieldLogger:** o [manual, seção 6.8.6][mercado-fieldlogger-manual], é explícito sobre
ausência de TLS e uso da memória interna para MQTT. O contrato do projeto exige
[MQTT seguro em produção](HARDWARE_SOFTWARE.md). Uma ponte local com TLS ou outra
arquitetura protegida pode viabilizar o equipamento, mas acrescenta componentes,
configuração e manutenção que entram no custo. Não liberar tráfego aberto na internet
para acomodar a limitação do equipamento.

Siemens S7-1200, Unitronics, Haiwell e Schneider M200 continuam como famílias a
avaliar mediante configuração e proposta equivalentes, sem classificação geral de
qualidade. A existência de um CLP da marca não comprova MQTT/TLS, histórico ou o
conjunto de entradas necessário na versão ofertada. Esta lista ampliada também não
pretende enumerar todo o mercado.

### 6.2 Como essas opções podem superar a referência atual

A comparação deve usar **o conjunto de aquisição e comunicação**, não apenas o
preço da CPU. Pelas referências de 04/11/2026:

| Referência atual, sem sensores/fontes/nobreak/instalação | Custo em reais |
|---|---:|
| M100-HM-GL + IO8000 + TDI340 + microSD | **3.597,26** |
| M100-HM-ETH + IO8000 + TDI340 + microSD | **2.916,23** |

Um concorrente pode custar mais que o gateway isolado e ainda ser econômico se
substituir o contador, expansões ou trabalho de desenvolvimento. Para uma comparação
válida, a proposta precisa cobrir **duas entradas 4–20 mA, doze estados digitais
(incluindo os dois diagnósticos de 12 V), um canal de pulsos, leitura dos medidores
Modbus, comunicação segura e histórico**. Contagem pode compartilhar uma DI, mas
essa DI não fica simultaneamente livre para outro sensor. Se retirar o TDI340,
substituir também as entradas compatíveis com os contatos RISCO, além da contagem.

Acrescentar 4G à proposta que for comparada ao GL, sem cobrar novamente recursos
que já estejam incluídos. Esses valores são referências de comparação, não limites
universais nem totais instalados; integração e manutenção em 36 meses podem inverter
a escolha. Não foi obtida proposta nacional completa das novas alternativas nem
foram solicitadas cotações aos fabricantes nesta revisão.

**Prioridade sugerida para fechar a escolha:** manter PUSR como referência de preço;
comparar primeiro **NEON 5**, **X502** e **Seneca com I/O**, junto do **Altus XP315**
já estudado. Levar ICP DAS, FieldLogger e PLC410 à rodada conforme necessidade de
registro, ambiente, suporte existente e orçamento. Essa ordem é uma avaliação de
adequação ao piloto, não um ranking de taxa de falhas.

Separar três evidências na decisão: **robustez elétrica/ambiental documentada**,
**funcionamento completo demonstrado** e **custo de manter/repor**. Para confiabilidade
comparativa, faltam dados de campo equivalentes. Exigir garantia, prazo real de
reposição e resultados dos mesmos testes da seção 8; prestígio da marca e quantidade
de protocolos não substituem essas evidências.

## 7. Trabalho de integração ainda necessário

O código inspecionado em 04/11/2026 recebe os contratos genérico e compacto da caixa,
mas não o relatório agrupado M100 proposto anteriormente. A revisão deste documento
**não implementa nem homologa essa integração**.

Na configuração do M100, **habilitar explicitamente o cache**, desativado por padrão
no manual consultado, e registrar sua capacidade e política de reenvio. Usar telemetria
com QoS 1 e sem retenção; status ONLINE e Last Will OFFLINE retidos, conforme o contrato
da plataforma. QoS 1 permite duplicatas e não substitui armazenamento persistente nem
deduplicação. Validar essas opções no firmware adquirido.

| Entrega | Requisito |
|---|---|
| Relatório real do equipamento | Capturar modelo, firmware, configuração e mensagens, incluindo erro e reconexão |
| Autorização e assinatura MQTT | Se adotar `predio/{buildingId}/gateway/{gatewayId}/report`, atualizar contrato, autorização no broker/API, assinatura e roteamento da ingestão; o tópico proposto não é aceito hoje |
| Normalização por dispositivo | Dividir relatório em amostras dos dispositivos cadastrados; validar vínculo de cada ponto ao gateway/prédio, escalas, unidades e 0/1 → booleano |
| Identidade e relógio | Identificação estável por amostra/métrica, UTC e relógio válido após reinício sem internet; resolver colisões se houver mais de uma amostra no mesmo instante representado |
| Qualidade e diagnóstico | Nunca converter timeout, falha Modbus, cabo rompido ou valor de erro em zero/normal; distinguir comunicação do gateway da saúde do sensor. RISCO aberto significa vazamento ou circuito aberto; falha identificada dos 12 V invalida o estado de seco |
| Consumo e reenvio | Ler o uint32 do TDI340 em dois registros de 16 bits, aplicar litros/pulso e referência inicial do mostrador. Preservar ordem ou recompor consumo; tratar reinício e transbordamento separadamente, sem zerar o contador na coleta |
| Boias e alimentação | Mapear sinais adicionais e implementar regras/painel necessários; métricas personalizadas aceitas não significam telas e regras prontas |
| Recuperação operacional | Backup de configuração, credencial por gateway, troca de equipamento e de cartão documentadas |

Referências de implementação:
[normalização](../services/ingest/src/pipeline/normalize.ts),
[assinatura MQTT](../services/ingest/src/mqtt.ts),
[autorização](../apps/api/src/modules/mqtt/routes.ts),
[consumo](../packages/shared/src/usage.ts) e
[regras](../services/ingest/src/rules/evaluate.ts).

O cálculo de consumo atual ignora amostras anteriores à última processada. Se uma leitura
atual ultrapassar o histórico pendente, apenas gravar o histórico no banco não recompõe
automaticamente os totais. Reenvio com horário original é necessário, mas não suficiente.
Uma redução do acumulado é tratada como reinício; o código não recompõe sozinho o
transbordamento do contador. O mapa Modbus e a conversão estão propostos na seção 5
da lista de compras e precisam de implementação/ensaio com a unidade real.

As regras de telemetria não disparam alertas para leituras com mais de cinco minutos.
Definir essa diferença entre histórico e incidente atual na operação. O Last Will depende
de o broker detectar a desconexão, inclusive pelo keepalive; não é detecção instantânea
de falta de energia nem identifica sozinho sua causa.

## 8. Critérios de aceitação antes de comprar em volume

Metas abaixo são **requisitos propostos de projeto**, não desempenhos já demonstrados.
Configurar a cadência conforme evento e janela de supervisão; falhas intermitentes menores
que o intervalo de leitura precisam de captura de evento ou retenção no campo.

| Teste | Condição de aprovação |
|---|---|
| Cobertura completa | Todos os pontos da seção 2 geram dados válidos, histórico, telas e alertas/regras previstos; nenhum ponto silenciosamente omitido |
| TLS e isolamento | Certificado inválido rejeitado, credenciais por gateway e impossibilidade de publicar no prédio/dispositivo alheio |
| Rede interrompida | Ensaiar 1 h, 24 h e 72 h sem internet, com equipamento alimentado; recuperar as amostras esperadas na cadência contratada, com horários originais e sem efeitos duplicados |
| Energia durante gravação | Interromper repetidamente, inclusive durante gravação/reenvio; medir a janela de perda, verificar integridade e retomada automática. Para o kit contratado, exigir ausência de perda enquanto o nobreak sustenta a carga |
| Autonomia elétrica | Medir pelo menos 60 min com gateway, fontes, sensores e toda a rede local necessária; testar retorno após esgotar bateria |
| Contagem de água | Conferir variante, documentação metrológica, vazões, posição e emissor. Aplicar pulsos conhecidos e rebote, reconectar, reiniciar e cortar alimentação; conferir escala, retenção e total mecânico. O manual do TDI340 documenta memória, mas não quantifica a janela de perda dos últimos pulsos |
| Consumo recuperado | Totais corretos após interrupção, reenvio fora de ordem, duplicação, virada de dia e reinício de contador; sem consumo fictício |
| Falha de sensor/RS485 | Interromper um dispositivo/cabo e simular erro; não aparecer "normal" ou zero inventado; dispositivos saudáveis continuam sendo lidos |
| Nível e boias | Conferir nível em pelo menos três pontos e demonstrar divergência entre boia e analógico sem afetar o comando local da bomba |
| Alarmes e estados | Simular contatos de água, esgoto, gás, central e alimentação; medir tempo até painel/notificação e confirmar comportamento offline |
| Vazamentos RISCO | Ensaiar molhado/seco, atraso de detecção, falta de 12 V, fusível aberto, ruptura e curto do circuito; registrar limitações e resolver as incompatíveis com o risco local. Confirmar limpeza e teste ao menos semanal conforme manual |
| Conexão 4G, quando contratada | Cortar acesso à internet sem tirar cabo Ethernet; trocar automaticamente, reconectar e retornar ao link principal sem corromper contagem |
| Capacidade e manutenção | Simular fila cheia, falha/ausência de SD, erro de relógio e substituição do gateway; falha identificável, nunca perda silenciosa apresentada como operação normal |
| Piloto em campo | Operar por pelo menos 14 dias com todos os pontos; registrar perdas, reinícios, falsos alertas e intervenções |

Testar períodos offline não significa exigir notificações pela nuvem sem conexão. Os
alarmes locais de gás/incêndio e proteções da bomba permanecem independentes da plataforma.
Pulsos ocorridos após esgotar a alimentação do contador podem ser perdidos mesmo que sua
memória seja retentiva; não prometer consumo contínuo nessa condição. Se isso for obrigatório,
dimensionar maior autonomia ou usar medição com acumulador autônomo apropriado.

Guardar relatório com firmware, configuração, topologia, carga elétrica, frequência de
amostragem, mensagens reais e resultados. Simuladores e testes automatizados da plataforma
complementam essa evidência, mas não comprovam robustez elétrica ou durabilidade do hardware.

## 9. Sequência de compra e implantação

1. Levantar pontos, distâncias, ambiente, rede elétrica, internet e equipamentos existentes.
   Fixar se é aceitável perder notificações remotas temporariamente por queda de link.
2. Recotar o kit M100 e as alternativas aplicáveis com **mesmo escopo**, incluindo peças
   novas, garantia, substituição, integração e comissionamento. Verificar variante/firmware.
3. Comprar ou obter para avaliação **um conjunto para a instalação completa do piloto**,
   seguindo a lista detalhada. Concluir o adaptador e testar o mesmo conjunto antes
   da montagem definitiva; não é necessário comprar uma segunda bancada.
4. Instalar no condomínio depois de aprovar as funções e condições de montagem.
   Evitar comprar simultaneamente vários modelos sem uma pergunta técnica a resolver.
5. Se reprovar, identificar a causa: integração, sensor, energia, armazenamento ou rede.
   Corrigir o elo responsável; migrar para M300/Altus apenas quando isso resolver a causa
   e a nova solução também passar nos testes. IO8000, sensores e parte do quadro podem
   ser reaproveitados conforme interfaces e dimensionamento, não por suposição.
6. Padronizar configuração e peças após o piloto. Planejar reposição de bateria/cartão,
   calibração conforme fabricante e equipamento reserva compartilhado quando o prazo
   de atendimento justificar.

A compra em escala fica condicionada à homologação. **O objetivo é o menor custo do
monitoramento que funciona e pode ser mantido, e não o menor preço isolado do controlador.**

## 10. Fontes e limites da revisão

Documentação da base consultada em 04/11/2026 e ampliação de mercado em 05/11/2026;
conferir a revisão correspondente ao equipamento efetivamente entregue:

- [PUSR M100-HM: MQTT/TLS, SD e variantes](https://www.pusr.com/uploads/20241205/285a4d714f715d1ad8a693f499136208.pdf).
- [PUSR M100: modelo de JSON](https://www.pusr.com/download/USR-M100%20User-Manual_V1.0.1.pdf).
  Não presumir que todos os recursos desse manual existam em qualquer firmware HM.
- [PUSR USR-IO: entradas e interfaces](https://www.pusr.com/uploads/20240611/566c67bb606301807c94c4f8bf37d32c.pdf).
- [Teracom TDI340: manual R1.11, firmware V1.06+](https://www.teracomsystems.com/download/s0-pulse-counter-with-modbus-rtu-interface-tdi340-user-manual/): memória não volátil, entradas de baixa tensão e registros.
- [RISCO Flood Detector](https://riscogroup.com/en/rscm_product/flood-detector/)
  e [manual do fabricante 5IN1478 D, hospedado no suporte Golmar](https://d7rh5s3nxmpy4.cloudfront.net/CMP5021/files/5IN1478-D-Wired-Flood-Detector-Instructions-ML-WEB_%281%29.pdf).
- [Renova: manual de instalação residencial](https://empresa.renovamedicao.com.br/wp-content/uploads/2024/04/Manual-de-instalacao-hidrometro-Residencial.pdf)
  e [kit UR equipado selecionado](https://www.renovamedicao.com.br/hidrometroresidencial/hidrometro-unijato-4m-dn20x115mm-equipado-com-sensor-nova-portaria-inmetro).
- [Mean Well HDR-15: fonte LPS de 12 V](https://www.meanwell.com/Upload/PDF/HDR-15/HDR-15-SPEC.PDF).
- [PUSR M300: recursos anunciados](https://www.pusr.com/products/industrial-IoT-Gateway.html).
- [NOVUS DigiRail-4C: manual de instalação](https://www.wolfautomation.com/content/novus-digirail-digitalcounterinput-instructionmanual.pdf)
  e [manual de comunicação do fabricante, hospedado por distribuidor](https://cdn02.duxcloud.com.br/exsense/products/43/files/manual-de-comunicacao-L5p7c0Kz.pdf).
- [NOVUS DigiRail IoT: canais, isolamento e buffer](https://cdn.novusautomation.com/downloads/manual_digirail_iot_v10x_en.pdf).
- [Altus Nexto Xpress: interfaces, contagem e recursos industriais](https://www.altus.com.br/wp-content/uploads/2024/10/Nexto-Xpress-pt-Rev-J.pdf)
  e [MQTT com TLS 1.2](https://www.altus.com.br/en/post/343/clps-da-serie-nexto-contam-com-suporte-a-tls-1-2-para-criptografia-de-mensagens-mqtt/).
- [Teltonika TRB246: envio de dados](https://wiki.teltonika-networks.com/view/TRB246_Data_to_Server)
  e [discussão do suporte sobre buffer Modbus e persistência](https://community.teltonika.lt/t/trb145-trb246-modbus-data-buffering-during-connectivity-loss-ram-database-capped-at-1-3-mb-moving-it-to-flash-via-uci-works-is-it-supported/21167).
  Relatos e orientações referem-se às versões discutidas; validar a versão escolhida.
- [Lista de compras e fontes por equipamento](COMPRAS_PILOTO.md): preços, quantidades,
  alternativas e leituras adicionais de manuais. Confirmar fornecimento do TDI340,
  prazos dos sensores e da fonte adicional; preços iniciais de sonda, variantes e
  provisões não equivalem a propostas fechadas.

Esta revisão retira as notas ponderadas apresentadas como empate de robustez, a
afirmação de funcionamento completo antes da integração e a referência de contador usado
como base de produção. A lista detalhada mantém quatro boias, modelos identificados,
4G integrado e condições de compra. Esta rodada reduz água e vazamentos, incluindo
fonte e interfaces necessárias, sem declarar equivalência de proteção ou durabilidade
não demonstrada. Mantém o M100 como candidato econômico, com integração, alimentação
de reserva e critérios de aprovação explícitos.

[mercado-neon]: https://www.hitecnologia.com.br/produto/clp-neon5/
[mercado-neon-manual]: https://materiais.hitecnologia.com.br/media/private_uploads/manuais-pet/Plc/NEON/pmu11105000.pdf
[mercado-rion]: https://www.hitecnologia.com.br/produto/rion/
[mercado-contemp]: https://contemp.com.br/produto/central-iot-x502-contemp
[mercado-contemp-manual]: https://contemp.com.br/api/arquivos/x502_rev.00_enma.pdf
[mercado-seneca-ficha]: https://www.seneca.it/media/6850577/25_0592p01_seneca_z-key_r-key-eng-r1.pdf
[mercado-seneca-br]: https://seneca.lri.com.br/gateways-protocolo/
[mercado-icpdas]: https://www.icpdas.com/en/product/WISE-5231
[mercado-icpdas-br]: https://icpdas.lri.com.br/iiot-edge-vibracao/wise-5231/
[mercado-fieldlogger]: https://www.novus.com.br/pt/produto/data-loggers/fieldlogger/downloads
[mercado-fieldlogger-manual]: https://cdn.novusautomation.com/downloads/manual_fieldlogger_v19x_a_pt.pdf
[mercado-weg-manual]: https://static.weg.net/medias/downloadcenter/hab/h88/WEG-PLC410-manual-do-usuario-10010696216-PT.pdf
[mercado-weg-preco]: https://loja.csaautomacao.com.br/produto/controlador-logico-programavel-weg-plc500-5/
