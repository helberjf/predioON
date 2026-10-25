# Estudo de equipamentos: gateway e CLP

Revisão de 24/10/2026 do estudo anterior (as pranchas "Comparação de 5 opções de hardware" e
"Hardware da primeira instalação", de outubro de 2026). O foco é a peça que decide o projeto: o
equipamento que lê os sensores e fala com a plataforma. São apresentadas duas soluções, uma com
gateway e outra com CLP. O restante do kit está no anexo (seção 11).

Cada candidato foi conferido contra o contrato do repositório ([HARDWARE_SOFTWARE.md](HARDWARE_SOFTWARE.md),
[SENSORES.md](SENSORES.md), `packages/shared/src/telemetry.ts`). Os preços são do Mercado Livre em
24/10/2026, sem frete nem mão de obra, salvo indicação. Cote antes de comprar.

## 1. Resposta curta

- **Gateway e CLP atendem o Prédio ON.** Mesmo dando mais peso à robustez, os dois ficam praticamente
  empatados (3,85 contra 3,80 na seção 6). O CLP custa cerca de R$ 3.500 a mais por condomínio.
- **Linha Essencial, com gateway: USR-M100-HM-ETH + USR-IO8000**, R$ 1.539. Com o kit completo,
  cerca de **R$ 4.206**. É o menor custo, com cache offline documentado, mas precisa de um adaptador
  na ingestão (seção 10).
- **Linha Industrial, com CLP: Altus Nexto Xpress XP325**, R$ 5.044–6.100. Com o kit completo,
  cerca de **R$ 7.711**. É fabricante nacional, tem MQTT com TLS 1.2 no próprio CLP e software de
  programação gratuito. O programa do CLP gera o JSON exato da plataforma, sem adaptador.
- **Plano B da linha Essencial: USR-M300-GL + IO8000**, R$ 3.138, se o M100 falhar na bancada.
- **Outros CLPs:** Siemens S7-1200 quando o cliente padroniza Siemens, WEG PLC410 quando exige WEG e
  Haiwell A8 como CLP de menor custo, com ressalvas.
- **Saem da lista:** Schneider M200, que não tem MQTT, e Unitronics UniStream, que não se encontra
  no varejo brasileiro.

## 2. Gateway ou CLP: o que o campo precisa fazer

| Função | Onde fica |
|---|---|
| Ler entradas 4–20 mA, contatos secos e o barramento RS485 | Equipamento de campo |
| Transformar cada leitura no JSON do contrato e publicar por MQTT com TLS | Equipamento de campo, ou o adaptador na ingestão |
| Guardar leituras durante a queda de internet e reenviar com o horário original | Equipamento de campo |
| Avisar a própria queda (last will) | Equipamento de campo e broker |
| Regras, alertas, histórico e consumo | Plataforma (ingestão e API) |
| Ligar bomba ou abrir portão | Ninguém no escopo padrão |

A bomba é só monitorada, as automações não comandam equipamento ([AUTOMACOES.md](AUTOMACOES.md)) e
os portões vêm desligados por padrão (`infrastructure/049-physical-features-opt-in.sql`).

**O papel clássico do CLP é executar lógica de controle local com tempo determinístico.** No escopo
padrão não há controle a fazer, então a vantagem do CLP não está na função, e sim na robustez do
hardware, no suporte e na possibilidade de lógica local no futuro (seção 3). O controle que já
existe no prédio, de boia e contator da bomba, fica no quadro elétrico e deve continuar funcionando
sem internet.

As opções se dividem em cinco arquiteturas:

| Arquitetura | Exemplos | Quando faz sentido |
|---|---|---|
| A. Gateway com entradas próprias | M100-HM, M300, Teltonika TRB246 | Monitoramento puro, com menor custo |
| B. CLP com MQTT | Altus Nexto Xpress, WEG PLC410, Siemens S7-1200, Haiwell A8 | Robustez industrial, padrão do cliente ou lógica local |
| C. CLP + gateway separado | Schneider M200 + gateway | Prédio que já tem CLP instalado |
| D. Computador embarcado + módulos Modbus | Raspberry Pi industrial | Quando a equipe quiser controlar todo o software de campo |
| E. Microcontrolador | Placas ESP32 industriais | Escala alta, com firmware próprio |

## 3. CLP é mais robusto?

Como hardware, sim. Para o sistema todo, depende do que se espera dele.

| Aspecto | CLP (Altus Nexto Xpress) | Gateway (PUSR M100-HM) |
|---|---|---|
| Projeto do hardware | Feito para painel industrial, com opção de tropicalização (verniz contra umidade e maresia) | Industrial, com proteções de ESD, surto e EFT nível 3 e faixa de −25 a 75 °C |
| Entradas | 16 digitais 24 V e 5 analógicas na mesma peça | 2 digitais e 2 analógicas, mais um módulo de expansão |
| Vida útil e reposição | Fabricante nacional, linha longa e assistência no Brasil | Fabricante chinês, ciclos de produto mais curtos |
| Técnicos que sabem mexer | Qualquer técnico de automação conhece CLP | Menos conhecido |
| Conexão com a nuvem | O bloco MQTT existe, mas o JSON, a fila offline e a reconexão são programa nosso. Mais código próprio, mais chance de erro | MQTT, TLS e cache já vêm prontos e testados pelo fabricante |
| Lógica local sem internet | Forte: alarme local, intertravamento e temporização | Simples: uma entrada aciona uma saída |
| Preço | R$ 5.044–6.100 | R$ 1.539 |

**O que o CLP não resolve:** a leitura percorre uma corrente (sensor → equipamento de campo →
internet → plataforma) e a corrente quebra no elo mais fraco. Na prática, os elos que mais falham são
a internet do condomínio, a energia e os sensores. Um CLP fortalece só o elo do meio. Ele não mantém
a internet no ar nem evita um sensor descalibrado. Pelo mesmo motivo, colocar CLP e gateway em série
(arquitetura C) não deixa o sistema mais confiável: soma mais uma peça que pode falhar.

**Quando o CLP se paga:**
- o cliente exige padrão industrial ou marca nacional (prédios comerciais, hospitais, indústria);
- a oferta inclui alarme local que precisa funcionar sem internet, como sirene de alagamento ou
  proteção da bomba contra funcionamento a seco. Isso hoje está fora do escopo;
- o ambiente é agressivo (casa de máquinas úmida, maresia) e a versão tropicalizada faz diferença;
- a manutenção vai ficar com um técnico de automação local.

## 4. Requisitos que decidem

### 4.1 Entradas

Por condomínio, no escopo padrão:

- até 2 entradas 4–20 mA (caixa superior e cisterna);
- cerca de 6 entradas digitais (bomba, vazamento, central de incêndio, duas boias e uma reserva para
  gás ou pulso do hidrômetro);
- um barramento RS485 (medidor de energia e sensor de temperatura);
- nenhuma saída, a não ser que se adote alarme local.

### 4.2 O contrato da plataforma

A ingestão recusa qualquer mensagem fora do schema. "MQTT nativo" não basta:

| Exigência | M100 (manual do M100-HM) | CLP programável (Altus) |
|---|---|---|
| Uma métrica por mensagem, no tópico do dispositivo `predio/{buildingId}/device/{deviceId}/telemetry` | Relatório que junta vários pontos num JSON, com até 16 tópicos | O programa publica uma mensagem por métrica |
| `eventId` de 8 a 128 caracteres, repetido na retransmissão | Não há campo para isso | Montado no programa (gateway + métrica + horário) |
| `timestamp` ISO 8601 em UTC | Formato não documentado | Montado a partir do relógio do CLP, sincronizado por SNTP |
| Booleanos como `true`/`false` | Provavelmente 0/1 | Montado no programa |
| Falha de leitura nunca vira valor normal | Substitui o valor por um texto, como `"error"` | O programa marca `quality: "BAD"` |
| Status `ONLINE` retido e last will `OFFLINE` | Tem last will e retain | Status periódico pelo programa. Last will a confirmar no bloco MQTT da Altus |

Só os equipamentos programáveis montam esse JSON sozinhos: os CLPs, o Node-RED no M300, o Lua na
Teltonika e o firmware próprio no Linux ou no ESP32.

### 4.3 Leituras durante a queda de internet

[HARDWARE_SOFTWARE.md §3](HARDWARE_SOFTWARE.md) exige que o equipamento guarde as leituras e reenvie
depois. Sem isso, cada queda abre um buraco no consumo. A análise histórica só aceita dias com pelo
menos 80% de cobertura ([CONSUMO_E_ANALISE.md](CONSUMO_E_ANALISE.md)).

### 4.4 Operação de muitos condomínios

O equipamento precisa permitir copiar a configuração de um condomínio para outro, atualizar firmware
ou programa a distância e trocar uma unidade com defeito sem reprogramar tudo.

## 5. Candidatos

| Opção | Arq. | Preço | Entradas | Fala o contrato? | Guarda offline? | Observações |
|---|---|---|---|---|---|---|
| **USR-M100-HM-ETH + USR-IO8000** | A | R$ 1.539 (R$ 1.190–1.213 + R$ 349) | 2 AI 4–20 mA, 10 DI, 2 RS485 | Com adaptador na ingestão | Sim, em cartão SD, documentado no manual | Só Ethernet, sem rádio. O M100-ETH comum (R$ 999) não tem cache |
| USR-M300-GL + USR-IO8000 | A | R$ 3.138 (R$ 2.789 + R$ 349) | 2 AI 4–20 mA, 10 DI, RS485 | Sim, por fluxo Node-RED | O fabricante anuncia cache com reenvio. Confirmar se vale para fluxos Node-RED | Linux. Conferir se o anúncio inclui rede celular e a homologação Anatel |
| Teltonika TRB246 + módulos Modbus | A | Fora do Mercado Livre; €131–244 na Europa | 1 AI 0–30 V e 3 E/S. Mais entradas por módulos Modbus (R$ 52 com 2 × 4–20 mA, R$ 99 com 4 DI) | Sim, com Data to Server e Lua para ISO 8601 | A confirmar | 4G e gestão remota (RMS). Conferir distribuidor e Anatel |
| **Altus Nexto Xpress XP325** | B | R$ 5.044–6.100 | 16 DI, 5 AI tensão/corrente (até 10), 4 AO, RS485, CAN, USB | Sim, programando em CODESYS | Por programa: fila em memória retentiva ou datalogger em USB | MQTT com TLS 1.2 nativo, SNTP, relógio interno, software gratuito, fabricante nacional. O XP315 do estudo saiu do Mercado Livre; o XP300 (R$ 3.000–3.300) não tem entradas analógicas |
| Siemens S7-1200 G2 CPU 1212C + CB 1241 + SM 1231 | B | ≈ R$ 4.800 (R$ 2.200 + R$ 650 + R$ 1.950) | 8 DI, 4 AI, RS485 | Sim, programando em TIA Portal | Por programa, com cartão de memória | MQTT por biblioteca da Siemens, não nativo. TIA Portal é licenciado. Três peças |
| WEG PLC410 + MOD2.00 | B | ≈ R$ 7.180 (R$ 5.399 + R$ 1.784) | 7 AI no módulo, mais as E/S da CPU | Sim, programando em CODESYS | Por programa | MQTT publisher e subscriber nativos. Nacional |
| Haiwell A8 + A04XA | B | R$ 2.615 (R$ 1.756 + R$ 859) | 8 DI, 2 AI | Formato do JSON e TLS não documentados | Não verificado | CLP de menor custo, voltado à nuvem do fabricante |
| Raspberry Pi industrial + serviço Node do Prédio ON | D | Pi 5 4 GB por R$ 692–1.263, mais placa RS485 e caixa. Versão industrial importada: US$ 209–385 | Por módulos Modbus | Sim, exato: reusa `@predioon/shared` | A implementar (fila local) | A equipe passa a manter sistema e software. O cartão SD é o ponto fraco |
| Placa ESP32 industrial | E | R$ 291–349 | 8 DI isoladas, AI 0–10 V, RS485 | Sim, com firmware próprio em C++ | A implementar | Maior esforço de software. Wi-Fi exige homologação |
| Schneider TM200CE24R + gateway | C | R$ 1.490–2.100, mais módulo analógico e gateway | 14 DI, 10 relés | Não: precisa de um gateway a mais | Depende do gateway | Três equipamentos para um trabalho |

## 6. Pontuação

Notas de 1 a 5 em cada critério, em dois perfis de peso:

| Critério | Perfil custo | Perfil robustez | O que vale 5 |
|---|---|---|---|
| Custo de hardware | 25% | 10% | Até R$ 1.600 com as entradas do escopo |
| Integração com o contrato | 20% | 15% | Fala o contrato sem desenvolvimento por condomínio |
| Leituras offline | 15% | 15% | Cache nativo e documentado |
| Operação remota | 15% | 10% | Gestão central, atualização a distância e cópia de configuração |
| Disponibilidade e suporte no Brasil | 15% | 20% | Fabricante ou vendedor nacional e técnicos que conhecem o equipamento |
| Robustez industrial | 10% | 30% | Projeto para painel industrial, linha longa e opção de tropicalização |

| Opção | Custo | Integração | Offline | Remota | Brasil | Robustez | **Perfil custo** | **Perfil robustez** |
|---|---|---|---|---|---|---|---|---|
| **M100-HM + IO8000** | 5 | 3 | 4 | 3 | 4 | 4 | **3,90** | **3,85** |
| Teltonika TRB246 + módulos | 3 | 4 | 4 | 5 | 2 | 5 | 3,70 | 3,90 |
| M300-GL + IO8000 | 3 | 4 | 3 | 4 | 4 | 4 | 3,60 | 3,75 |
| **Altus XP325** | 1 | 3 | 3 | 3 | 5 | 5 | **3,00** | **3,80** |
| WEG PLC410 + MOD2.00 | 1 | 3 | 3 | 3 | 5 | 5 | 3,00 | 3,80 |
| Siemens S7-1200 + módulos | 2 | 2 | 3 | 3 | 5 | 5 | 3,05 | 3,75 |
| Placa ESP32 | 5 | 3 | 3 | 2 | 3 | 2 | 3,25 | 2,80 |
| Raspberry Pi industrial | 3 | 4 | 3 | 3 | 3 | 2 | 3,10 | 2,85 |
| Haiwell A8 + A04XA | 3 | 2 | 2 | 3 | 3 | 4 | 2,75 | 3,00 |
| Schneider M200 + gateway | 2 | 1 | 2 | 2 | 5 | 5 | 2,55 | 3,35 |

As notas são julgamento, com base no que a seção 5 documenta. O Siemens leva 2 em integração porque
o MQTT vem de biblioteca e o software de programação é pago.

**Como ler:**
- **No perfil robustez, gateway e CLP empatam.** Teltonika (3,90), M100 (3,85) e Altus (3,80) ficam a
  0,1 ponto um do outro. A escolha passa a ser comercial: o CLP custa cerca de R$ 3.500 a mais por
  condomínio.
- **Se a operação remota pesar 30% no perfil custo**, tirados do custo, o Teltonika (4,00) e o M300
  (3,75) passam à frente do M100 (3,60).
- **Se o Teltonika custar menos de R$ 1.600 no Brasil**, ele lidera os dois perfis.
- **Se o M100 falhar no teste de horário ou de cache na bancada**, sua nota offline cai para 2 e ele
  perde a liderança no perfil custo.

## 7. Esforço de integração

| Opção | Desenvolvimento único | Trabalho em cada condomínio |
|---|---|---|
| M100-HM | Adaptador na ingestão (seção 10), no mesmo padrão do contrato compacto da caixa d'água | Cadastrar os pontos na interface web. Exportar e importar parâmetros reaproveita a configuração |
| M300 | Fluxo Node-RED que monta o contrato, e fila local se o cache não cobrir o fluxo | Importar o fluxo e ajustar os IDs |
| Teltonika | Coleções do Data to Server e script Lua | Restaurar a configuração ou aplicar pelo RMS |
| CLP (Altus, WEG, Siemens) | Um programa por marca de CLP (seção 9), feito por integrador de automação ou pela equipe em Texto Estruturado | Carregar o programa e preencher a tabela de parâmetros do condomínio |
| Raspberry Pi | Serviço de gateway em Node: Modbus, fila, MQTT, atualização e watchdog | Gravar a imagem e ajustar a configuração |
| ESP32 | Firmware completo: TLS, NTP, fila em flash e atualização remota | Gravar firmware e configuração |

## 8. Linha Essencial: gateway M100-HM

**Por que ele:**
- custa menos da metade das alternativas programáveis, com as entradas que o escopo usa;
- é o único com cache offline descrito no manual;
- a versão só Ethernet não tem rádio, então não depende de homologação de rádio;
- é vendido no Brasil pela loja da PUSR, com frete grátis;
- exporta e importa a configuração entre unidades.

**Riscos e como reduzir:**

| Risco | Mitigação |
|---|---|
| O modelo de JSON não incluir horário da amostra | Testar na bancada. Sem horário, o cache reenvia leituras que a plataforma não sabe datar: passar ao M300 |
| Atualização de firmware mudar o formato do relatório | Testes do adaptador escritos com um relatório real capturado na bancada. Repetir antes de atualizar firmware em campo |
| Suporte de fabricante chinês | Manter uma unidade reserva configurada. Firmware é atualizado pela interface web |
| Contagem de pulsos do hidrômetro sem acumulado persistente | Usar um módulo contador Modbus ou hidrômetro com saída Modbus |

**Compra para a bancada:** um M100-HM-ETH, um IO8000, um cartão microSD industrial e uma fonte 24 V.

**Quando trocar para o plano B (M300-GL):** se o M100 falhar no teste de horário ou de cache, ou se o
condomínio não tiver internet confiável e precisar de rede celular.

## 9. Linha Industrial: CLP Altus Nexto Xpress XP325

**Por que ele, entre os CLPs:**
- traz na mesma peça tudo o que o escopo usa: 16 entradas digitais, 5 analógicas 4–20 mA, RS485
  mestre Modbus, Ethernet e relógio interno. O Siemens precisa de três peças;
- tem MQTT com TLS 1.2 no próprio CLP, documentado pela Altus. No Siemens o MQTT vem de biblioteca;
- o software de programação (MasterTool IEC XE, baseado em CODESYS) é gratuito. O TIA Portal da
  Siemens é pago;
- é fabricante nacional, com opção de tropicalização;
- custa menos que o WEG PLC410 com módulo analógico (≈ R$ 7.180).

**Arquitetura:** sensores → XP325 → MQTT com TLS → broker. O CLP é o próprio gateway, e não há
adaptador na ingestão.

**O que o programa do CLP precisa fazer** (escrito uma vez e reaproveitado em todos os condomínios):

1. Ler as entradas digitais, as 4–20 mA (com escala para % e litros) e, como mestre Modbus RTU, o
   medidor de energia e o sensor de temperatura.
2. Sincronizar o relógio por SNTP. O relógio interno mantém a hora durante a queda de rede.
3. Montar, por leitura, o JSON do contrato: `schemaVersion`, `eventId`, `buildingId`, `deviceId`,
   `metric`, `value`, `unit`, `quality` e `timestamp` em UTC.
4. Publicar com o bloco MQTT da Altus em TLS 1.2 e QoS 1, no tópico de cada dispositivo, e publicar o
   status `ONLINE` retido periodicamente.
5. Guardar em fila na memória retentiva (ou em datalogger USB) o que não foi publicado, e reenviar
   depois com o mesmo `eventId` e horário.
6. Marcar `quality: "BAD"` quando a leitura Modbus falhar, nunca enviar zero no lugar.
7. Ler IDs e escalas de uma tabela de parâmetros do condomínio, não do código.

Quem programa pode ser um integrador de automação que conheça CODESYS, ou a equipe aprendendo Texto
Estruturado (ST), a linguagem de texto dos CLPs.

**Riscos e como reduzir:**

| Risco | Mitigação |
|---|---|
| O bloco MQTT da Altus não oferecer last will | A plataforma já marca o gateway OFFLINE quando o status deixa de chegar. Confirmar na bancada |
| Memória retentiva pequena para a fila | Dimensionar quantas horas de queda guardar e testar. Se faltar, usar datalogger USB |
| Taxa de publicação: são 15 a 20 mensagens por ciclo, uma por métrica | Medir na bancada e ajustar o intervalo de leitura |
| Validação do certificado do broker | Carregar a cadeia do certificado no CLP e testar sem desligar a verificação |
| Programa próprio com erro | Testar contra `pnpm simulate:hardware` e o roteiro de bancada antes do primeiro condomínio |

**Compra para a bancada:** um XP325, uma fonte 24 V e um pen drive industrial, se a fila for em USB.

**Alternativas dentro da linha Industrial:**

| CLP | Preço do controlador | Quando escolher |
|---|---|---|
| Siemens S7-1200 G2 CPU 1212C + CB 1241 + SM 1231 | ≈ R$ 4.800 | Cliente ou integrador padronizado em Siemens. Somar a licença do TIA Portal |
| WEG PLC410 + MOD2.00 | ≈ R$ 7.180 | Cliente que exige WEG |
| Haiwell A8 + A04XA | R$ 2.615 | Orçamento apertado e aceitação de menos suporte. Confirmar JSON e TLS antes |

## 10. Adaptador do M100 e validação em bancada

### 10.1 Adaptador na ingestão (só para o M100)

Um perfil de gateway que aceite o relatório do M100:

- tópico próprio do gateway (por exemplo, `predio/{buildingId}/gateway/{gatewayId}/report`),
  liberado no autorizador do broker. A identidade continua vindo do tópico;
- mapeamento de cada ponto do relatório para `deviceId`, métrica e escala em `devices.metadata`,
  como [HARDWARE_SOFTWARE.md §8](HARDWARE_SOFTWARE.md) já prevê;
- `eventId` derivado de gateway, ponto e horário da amostra, com a mesma técnica que
  `services/ingest/src/pipeline/normalize.ts` já usa no contrato compacto da caixa d'água;
- 0/1 convertido para booleano nas métricas booleanas, e o texto de falha descartado, nunca gravado
  como zero;
- o relatório recebido contando como sinal de vida do gateway.

Esse adaptador deve ser escrito a partir de um relatório real capturado na bancada, não do manual.

### 10.2 Roteiro de bancada (gateway ou CLP)

- [ ] TLS 1.2 com o broker de produção, validando a cadeia do certificado, sem desligar a verificação;
- [ ] horário em UTC nas mensagens depois da sincronização (NTP ou SNTP);
- [ ] internet cortada por uma hora: as leituras guardadas chegam depois com o horário original;
- [ ] energia cortada: o painel mostra o equipamento OFFLINE (por last will ou por tempo sem status);
- [ ] contagem de pulsos do hidrômetro numa entrada digital, com acumulado preservado após reinício;
- [ ] leitura 4–20 mA comparada com medição manual em dois níveis;
- [ ] formato das entradas digitais e do valor de falha nas mensagens;
- [ ] reinício sem nenhuma saída acionada.

## 11. Anexo: demais equipamentos do kit

### 11.1 Kit da primeira instalação

Considera uma caixa d'água, uma bomba existente, um ponto de vazamento, central de incêndio existente
e entrada trifásica até 80 A. Os itens 1 a 12 são os mesmos nas duas linhas.

| # | Item | Faixa no Mercado Livre | Preço ref. | Antes |
|---|---|---|---|---|
| 1 | Fonte 24 V 2,5 A Mean Well MDR-60-24 | R$ 132–256 | R$ 175 | R$ 266 (5 A) |
| 2 | Sensor de nível submersível 4–20 mA, inox, 0–5 mca | R$ 592–751 nacional; R$ 151–592 importado | R$ 592 | R$ 667 |
| 3 | Sensor de temperatura e umidade RS485 XY-MD02 | R$ 119–159 nacional; R$ 48–136 importado | R$ 119 | R$ 159 |
| 4 | Sensor de alagamento com contato seco (2flex 2F-SDT-AG ou equivalente) | R$ 136 | R$ 136 | R$ 129,90 |
| 5 | Medidor trifásico RS485 Modbus (Chint DTSU666 até 80 A direto, ou Metaltex KWX-M) | R$ 534–699 | R$ 600 | R$ 597,60 |
| 6 | 2 × DPS classe II 20 kA 275 V (fase e neutro do quadro) | R$ 28–54 cada | R$ 90 | R$ 228 (3 da WEG) |
| 7 | Disjuntor do circuito de automação | Estimativa | R$ 33 | R$ 33 |
| 8 | 2 boias (alta e baixa), Margirius CB-2012 | R$ 63 o kit | R$ 63 | R$ 62 |
| 9 | Caixa metálica 400×300×200 IP65 | R$ 155–216 | R$ 195 | R$ 195 |
| 10 | Trilho, bornes, canaleta, prensa-cabos e fios | Estimativa | R$ 300 | R$ 450 (com relés de interface) |
| 11 | 2 rolos de 30 m de cabo de instrumentação 2×0,50 mm² blindado (4–20 mA e RS485) | R$ 167 o rolo | R$ 334 | sem linha própria |
| 12 | Ethernet e pequenos acessórios | Estimativa | R$ 30 | R$ 30 |
| | **Base** | | **R$ 2.667** | R$ 3.442,11 |

| Linha | Controlador | Preço do controlador | **Total do kit** |
|---|---|---|---|
| Essencial | M100-HM-ETH + IO8000 | R$ 1.539 | **≈ R$ 4.206** (−12% sobre os R$ 4.756,11 do estudo) |
| Essencial, plano B | M300-GL + IO8000 | R$ 3.138 | ≈ R$ 5.805 |
| Industrial | Altus XP325 | R$ 5.044–6.100 | **≈ R$ 7.711–8.767** |
| Industrial, Siemens | S7-1200 + CB 1241 + SM 1231 | ≈ R$ 4.800, mais licença do TIA Portal | ≈ R$ 7.467 |
| Industrial, menor custo | Haiwell A8 + A04XA | R$ 2.615 | ≈ R$ 5.282 |

### 11.2 Itens que saíram da base

- **Detector de fumaça próprio (R$ 44):** a detecção vem de central certificada (NBR 17240). Vender
  detecção própria é risco jurídico ([HARDWARE_SOFTWARE.md §7](HARDWARE_SOFTWARE.md)). O kit lê o
  contato seco da central existente.
- **Contator e relé de sobrecarga (R$ 324,37):** a plataforma não comanda a bomba, e o prédio já tem
  contator.
- **Relé de falta de fase (R$ 204,24):** é proteção do motor e pertence ao quadro elétrico. O
  multimedidor já entrega a tensão de cada fase. Virou módulo opcional.
- **Contato auxiliar do disjuntor (R$ 52):** disjuntores estão fora do escopo, e o equipamento de
  campo já avisa quando o quadro desliga.

### 11.3 Módulos por condomínio

| Módulo | Preço no Mercado Livre | Quando entra |
|---|---|---|
| Hidrômetro com saída pulsada e conexões | 3/4": R$ 306–488. 1": R$ 888–1.270. 2": R$ 1.499 | Quando o contrato incluir consumo de água. O diâmetro sai da vistoria, depois do medidor da concessionária |
| Segundo sensor de nível (cisterna) | R$ 592 | Prédio com dois reservatórios. Usa a segunda entrada 4–20 mA |
| Detector de gás convencional 12/24 V com saída a relé | R$ 266–300 (Intelbras DGC 423, Ascael ADGC-1224); genéricos por R$ 115–149 | Só onde houver gás canalizado ou GLP. Usa uma entrada digital |
| Relé de falta de fase WEG RMW17 | R$ 149–239 | Só se o quadro da bomba não tiver |
| Fonte com bateria (Mean Well DRC-60B, US$ 37 no exterior; fora do Mercado Livre) | Cotar | Só junto com rede celular no equipamento de campo: com Ethernet, o roteador do condomínio também desliga na falta de energia |

### 11.4 Onde ainda dá para economizar

- **Sensor de nível importado** (a partir de R$ 151): só depois de uma unidade aprovada em bancada, e
  com material adequado a água potável.
- **Medidor trifásico importado** (Eastron SDM630 a partir de R$ 221): só com mapa de registradores
  Modbus publicado.
- **Módulo Modbus genérico de 4 DI** (R$ 99) no lugar do IO8000, se a robustez se confirmar. Não vale
  para a linha Industrial, onde a peça barata anularia o motivo de usar CLP.

Não economize em fonte de marca, cabo blindado e DPS: falha nesses itens aparece como leitura errada
ou queima de equipamento.

## 12. Fontes consultadas em 24/10/2026

- PUSR: [manual do USR-M100-HM](https://www.pusr.com/uploads/20241205/285a4d714f715d1ad8a693f499136208.pdf),
  [página do M100](https://www.pusr.com/products/remote-io-edge-gateway.html),
  [anúncio que restringe o cache em SD ao M100-HM](https://thinkrobotics.com/products/industrial-iot-gateway-usr-m100),
  [página do M300](https://www.pusr.com/products/high-performance-edge-IoT-Gateway.html),
  [cache offline do M300 em ambiente remoto](https://www.pusr.com/blog/Edge-Computing-for-Remote-Industrial-Sites-What-Infrastructure-Do-You-Really-Need)
- Altus: [catálogo do Nexto Xpress](https://www.altus.com.br/wp-content/uploads/2024/10/Nexto-Xpress-pt-Rev-J.pdf),
  [TLS 1.2 no MQTT dos CLPs Nexto](https://www.altus.com.br/en/post/343/clps-da-serie-nexto-contam-com-suporte-a-tls-1-2-para-criptografia-de-mensagens-mqtt/),
  [bloco de função MQTT](https://www.altus.com.br/en/post/308/clp-altus-com-mqtt/)
- WEG: [catálogo do PLC410](https://static.weg.net/medias/downloadcenter/h0f/hc6/WEG-PLC.410-brochure-50161419-en.pdf)
- Teltonika: [datasheet do TRB246](https://download.axilogi.com/Teltonika/Datasheet/TRB246.pdf),
  [preço na Holanda](https://alcadis.nl/en/products/teltonika-trb246),
  [preço na Bélgica](https://www.mediamarkt.be/nl/product/_teltonika-trb246-4glte-gateway-gatewayscontrollers-148283084.html),
  [ISO 8601 com Lua](https://community.teltonika.lt/t/rut956-data-to-server-json-format-datetime-like-iso-8601/11602)
- Haiwell: [catálogo do A8](https://cdnda.static.haiwell.com/daruanjianen/Haiwell%20A8%20SmartLink%20PLC%20Catalog.pdf),
  [módulos analógicos](https://en.haiwell.com/hwproducts/176.html)
- Linux: [Seeed reComputer R1000](https://hackster.io/news/seeed-s-latest-recomputer-the-r1000-turns-a-raspberry-pi-cm4-into-an-industrial-iot-edge-box-bb75b07a0eb7),
  [preço do R1024](https://openelab.com/products/seeed-studio-recomputer-r1024-raspberry),
  [Raspberry Pi 5 no Mercado Livre](https://www.mercadolivre.com.br/raspberry-pi-5-4gb/p/MLB34101441)
- ESP32: [placa PLC no Mercado Livre](https://produto.mercadolivre.com.br/MLB-2774851196-automaco-com-esp32-placa-plc-com-8ed-6sd-1pwm-rs485-wi-fi-_JM),
  [KinCony KC868](https://shop.kincony.com/collections/kc868-ax)
- Módulos Modbus: [2 canais 4–20 mA](https://www.usinainfo.com.br/conversores-rs485/conversor-leitor-de-sinal-4-20ma-para-rs485-modbus-rtu-2-canais-8190.html),
  [4 DI e 4 DO](https://www.usinainfo.com.br/conversores-de-sinal/modulo-rs485-modbus-rtu-4-entradas-e-4-saidas-digitais-1224v-r4sls08-4di-4do-9192.html)
- Buscas no Mercado Livre em 24/10/2026, controladores:
  [USR-M100 e M300](https://lista.mercadolivre.com.br/usr-m100),
  [módulos USR-IO](https://lista.mercadolivre.com.br/pusr-usr-io),
  [Altus Nexto](https://lista.mercadolivre.com.br/clp-altus-nexto),
  [WEG PLC410](https://lista.mercadolivre.com.br/weg-plc410),
  [módulos analógicos WEG](https://lista.mercadolivre.com.br/weg-plc410-modulo-entradas-analogicas),
  [Siemens S7-1200 1212C](https://lista.mercadolivre.com.br/clp-s7-1200-cpu-1212c),
  [Siemens CB 1241](https://lista.mercadolivre.com.br/cm1241-rs485-siemens),
  [Siemens SM 1231](https://lista.mercadolivre.com.br/sm1231-4-entradas-analogicas-siemens),
  [Haiwell](https://lista.mercadolivre.com.br/clp-haiwell),
  [módulos Haiwell](https://lista.mercadolivre.com.br/haiwell-a04ai),
  [Schneider TM200CE24R](https://lista.mercadolivre.com.br/tm200ce24r),
  [Teltonika](https://lista.mercadolivre.com.br/teltonika-trb)
- Buscas no Mercado Livre em 24/10/2026, demais itens:
  [sensor de nível](https://lista.mercadolivre.com.br/sensor-nivel-submersivel-4-20ma),
  [XY-MD02](https://lista.mercadolivre.com.br/xy-md02),
  [DTSU666](https://lista.mercadolivre.com.br/dtsu666),
  [medidores trifásicos](https://lista.mercadolivre.com.br/medidor-energia-trifasico-rs485-modbus-trilho-din),
  [fonte MDR-60-24](https://lista.mercadolivre.com.br/fonte-mean-well-mdr-60-24),
  [DPS](https://lista.mercadolivre.com.br/dps-classe-ii-275v-20ka),
  [quadro 400×300×200](https://lista.mercadolivre.com.br/quadro-comando-400x300x200),
  [cabo de instrumentação](https://lista.mercadolivre.com.br/cabo-blindado-2x0,5mm-malha-instrumentacao),
  [sensor de alagamento](https://lista.mercadolivre.com.br/sensor-inundacao-contato-seco),
  [boias](https://lista.mercadolivre.com.br/chave-boia-nivel),
  [hidrômetros](https://lista.mercadolivre.com.br/hidrometro-saida-pulsada),
  [relé de falta de fase](https://lista.mercadolivre.com.br/rele-falta-de-fase-weg),
  [detector de gás](https://lista.mercadolivre.com.br/detector-gas-glp-saida-rele-12v)

A Unitronics UniStream não aparece no Mercado Livre e saiu da comparação.
