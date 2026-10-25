# Estudo de equipamentos: gateway e CLP

Revisão de 24/10/2026 do estudo anterior (pranchas de outubro de 2026). Preços do Mercado Livre em
24/10/2026, sem frete nem mão de obra, salvo indicação. Cote antes de comprar.

## Resumo: o que comprar

| Para quê | Equipamento | Preço do controlador | Kit completo |
|---|---|---|---|
| **Melhor custo-benefício** | Gateway PUSR **USR-M100-HM-ETH + USR-IO8000** | R$ 1.539 | **≈ R$ 4.206** |
| **Melhor CLP à venda no Brasil** | **Altus Nexto Xpress XP315** (por distribuidor) ou **XP325** (Mercado Livre) | R$ 4.500–6.100 | ≈ R$ 7.200–8.800 |
| CLP da imagem anterior | Unitronics UniStream USC-B3-R20 | €372 na Alemanha, mais importação | Só vale se a cotação no Brasil sair abaixo do Altus |

- **Por que o gateway é o de melhor custo-benefício:** o Prédio ON só monitora, e o M100-HM lê todas
  as entradas do projeto, guarda leituras quando a internet cai e custa um terço do CLP. Ele precisa
  de um adaptador na plataforma (seção 6).
- **Por que o Altus, se a escolha for CLP:** traz tudo numa peça (16 entradas digitais, 5 de
  4–20 mA, RS485), tem MQTT com TLS 1.2, software gratuito, fabricante nacional, e gera o JSON exato
  da plataforma sem adaptador.
- **Robustez:** dando 30% de peso a ela, gateway e CLP empatam (3,85 contra 3,80, seção 3). A
  diferença é o preço: cerca de R$ 3.500 a mais por condomínio com CLP.
- **Antes de comprar em volume:** testar uma unidade na bancada (seção 5).

## 1. Gateway ou CLP

O equipamento de campo precisa ler os sensores, publicar cada leitura no formato da plataforma por
MQTT com TLS e guardar leituras durante a queda de internet. **Ele não precisa comandar nada:** a
bomba é só monitorada, as automações não acionam equipamento ([AUTOMACOES.md](AUTOMACOES.md)) e os
portões vêm desligados por padrão.

O papel clássico do CLP é a lógica de controle local. Sem controle a fazer, sua vantagem está na
robustez:

| | CLP (Altus) | Gateway (M100-HM) |
|---|---|---|
| Hardware | Projeto de painel industrial, com opção de tropicalização contra umidade | Industrial, com proteções de ESD, surto e EFT nível 3 |
| Suporte | Fabricante nacional, linha longa, técnicos de automação conhecem | Fabricante chinês, menos conhecido |
| Conexão com a nuvem | JSON, fila offline e reconexão são programa nosso | MQTT, TLS e cache já vêm prontos |
| Lógica local sem internet | Forte: alarme, intertravamento, temporização | Simples: uma entrada aciona uma saída |

A leitura percorre uma corrente: sensor → equipamento → internet → plataforma. Os elos que mais
falham são internet, energia e sensores. O CLP fortalece só o elo do meio, e por isso CLP e gateway
em série não deixam o sistema mais confiável.

**O CLP se paga quando:** o cliente exige padrão industrial ou marca nacional; a oferta inclui alarme
local que funcione sem internet (hoje fora do escopo); ou o ambiente é agressivo (umidade, maresia).

## 2. CLPs da imagem anterior

| CLP | Se enquadra? | Por quê |
|---|---|---|
| **Unitronics UniStream USC-B3-R20** | Sim, tecnicamente | 10 DI, 2 AI 0–20 mA (usadas como 4–20 mA), 8 relés, 2 Ethernet, USB. O MQTT tem SSL, last will, QoS 1, retain e JSON. Precisa do módulo UAC-CB-01RS4 para RS485. **Não achei venda no Brasil**: €372 na Alemanha, e a importação por pessoa física pode quase dobrar o valor |
| **Altus Nexto Xpress XP315** | Sim | 16 DI, 5 AI tensão/corrente, 2 RTD, RS485, MQTT com TLS 1.2. Saiu do Mercado Livre (anúncios recentes: R$ 4.500–5.400). Comprar por distribuidor Altus ou usar o XP325 |
| Haiwell A8 | Parcialmente | 8 DI e MQTT, mas JSON e TLS não documentados. Precisa do módulo A04XA para 4–20 mA (R$ 1.756 + R$ 859 no Mercado Livre) |
| Schneider M200 | Não | Não tem MQTT: precisa de um gateway a mais |

**Conclusão:** o UniStream é o CLP que melhor casa com a plataforma, mas só é o de melhor
custo-benefício se um distribuidor no Brasil vender o conjunto (CLP + módulo RS485) abaixo de
≈ R$ 4.500. Sem isso, o Altus XP315 ou XP325 leva.

## 3. Comparação

Requisitos por condomínio: até 2 entradas 4–20 mA, cerca de 6 digitais, um barramento RS485, MQTT
com TLS no formato da plataforma ([SENSORES.md](SENSORES.md)) e cache offline
([HARDWARE_SOFTWARE.md §3](HARDWARE_SOFTWARE.md)).

| Opção | Preço | Fala o formato da plataforma? | Cache offline | Perfil custo | Perfil robustez |
|---|---|---|---|---|---|
| **M100-HM + IO8000** | R$ 1.539 | Com adaptador na plataforma | Sim, cartão SD | **3,90** | 3,85 |
| Teltonika TRB246 + módulos Modbus | Fora do Mercado Livre; €131–244 na Europa | Sim, com script Lua | A confirmar | 3,70 | **3,90** |
| USR-M300-GL + IO8000 | R$ 3.138 | Sim, com Node-RED | Anunciado pelo fabricante | 3,60 | 3,75 |
| **Altus XP315 / XP325** | R$ 4.500–6.100 | Sim, programando | Por programa | 3,00 | **3,80** |
| WEG PLC410 + MOD2.00 | ≈ R$ 7.180 | Sim, programando | Por programa | 3,00 | 3,80 |
| Siemens S7-1200 + CB 1241 + SM 1231 | ≈ R$ 4.800, mais licença do TIA Portal | Sim, MQTT por biblioteca | Por programa | 3,05 | 3,75 |
| Unitronics USC-B3-R20 + UAC-CB-01RS4 | €372 + módulo, mais importação | Sim, programando | Por programa | 2,65 | 3,10 |
| Haiwell A8 + A04XA | R$ 2.615 | Não documentado | Não verificado | 2,75 | 3,00 |
| Schneider M200 + gateway | R$ 1.490–2.100, mais módulo e gateway | Só pelo gateway | Depende do gateway | 2,55 | 3,35 |

Notas de 1 a 5 em seis critérios: custo, integração, cache offline, operação remota, disponibilidade
no Brasil e robustez. O **perfil custo** pesa custo em 25% e robustez em 10%. O **perfil robustez**
pesa custo em 10% e robustez em 30%. Placas ESP32 e Raspberry Pi ficaram de fora: exigem
desenvolver e manter firmware ou sistema próprio.

## 4. As duas linhas

### 4.1 Essencial: gateway M100-HM-ETH + IO8000

- **Compra:** M100-HM-ETH por R$ 1.190–1.213 e IO8000 (8 DI) por R$ 349. O M100-ETH comum (R$ 999)
  não tem cache offline, e o IO4040 (R$ 355) traz saídas que o projeto não usa.
- **Desenvolvimento:** adaptador na plataforma (seção 6).
- **Riscos:**
  - se o modelo de JSON não trouxer o horário da amostra, o cache fica inútil: passar ao plano B,
    M300-GL + IO8000 (R$ 3.138), que monta o formato exato por Node-RED;
  - fabricante chinês: manter uma unidade reserva configurada.

### 4.2 Industrial: CLP Altus Nexto Xpress XP315 ou XP325

- **Compra:** XP315 por distribuidor Altus (R$ 4.500–5.400 em anúncios recentes) ou XP325 no Mercado
  Livre (R$ 5.044–6.100). O XP300 (R$ 3.000–3.300) não tem entradas analógicas.
- **Programa do CLP** (feito uma vez, em CODESYS, por integrador ou pela equipe):
  1. ler entradas, 4–20 mA com escala e, como mestre Modbus, o medidor e o sensor de temperatura;
  2. sincronizar o relógio por SNTP;
  3. montar o JSON da plataforma por leitura (`eventId`, `metric`, `value`, `quality`, `timestamp`
     em UTC etc.);
  4. publicar por MQTT com TLS 1.2 e QoS 1, mais o status `ONLINE` periódico;
  5. guardar em fila o que não foi enviado e reenviar com o mesmo `eventId` e horário;
  6. marcar `quality: "BAD"` em falha de leitura, nunca enviar zero;
  7. ler IDs e escalas de uma tabela de parâmetros do condomínio.
- **Riscos:** last will não confirmado no bloco MQTT da Altus (a plataforma marca OFFLINE por tempo
  sem status); tamanho da memória para a fila; erros no programa próprio, a testar contra
  `pnpm simulate:hardware`.

## 5. Bancada antes de comprar em volume

- [ ] TLS 1.2 com o broker de produção, validando o certificado;
- [ ] horário em UTC nas mensagens depois da sincronização;
- [ ] internet cortada por uma hora: as leituras chegam depois com o horário original;
- [ ] energia cortada: o painel mostra o equipamento OFFLINE;
- [ ] pulsos do hidrômetro contados com acumulado preservado após reinício;
- [ ] leitura 4–20 mA comparada com medição manual em dois níveis;
- [ ] reinício sem nenhuma saída acionada.

## 6. Adaptador na plataforma (só para o M100)

O relatório do M100 junta vários pontos num JSON, sem `eventId` e com entradas como 0/1. A ingestão
precisa de um perfil de gateway que:

- receba o relatório num tópico próprio, como `predio/{buildingId}/gateway/{gatewayId}/report`;
- mapeie cada ponto para `deviceId`, métrica e escala em `devices.metadata`;
- derive o `eventId` de gateway, ponto e horário, como `services/ingest/src/pipeline/normalize.ts`
  já faz no contrato compacto da caixa d'água;
- converta 0/1 em booleano e descarte o texto de falha, nunca gravando zero;
- conte o relatório como sinal de vida do gateway.

Escrever a partir de um relatório real capturado na bancada, não do manual.

## 7. Kit da primeira instalação

Uma caixa d'água, uma bomba existente, um ponto de vazamento, central de incêndio existente e entrada
trifásica até 80 A. Os itens valem para as duas linhas.

| Item | Preço ref. | Antes |
|---|---|---|
| Fonte 24 V 2,5 A Mean Well MDR-60-24 | R$ 175 | R$ 266 (5 A) |
| Sensor de nível submersível 4–20 mA, inox, 0–5 mca | R$ 592 | R$ 667 |
| Sensor de temperatura e umidade RS485 XY-MD02 | R$ 119 | R$ 159 |
| Sensor de alagamento com contato seco | R$ 136 | R$ 129,90 |
| Medidor trifásico RS485 Modbus (Chint DTSU666) | R$ 600 | R$ 597,60 |
| 2 × DPS classe II 20 kA 275 V | R$ 90 | R$ 228 (3 da WEG) |
| Disjuntor do circuito de automação | R$ 33 | R$ 33 |
| 2 boias (alta e baixa) | R$ 63 | R$ 62 |
| Caixa metálica 400×300×200 IP65 | R$ 195 | R$ 195 |
| Trilho, bornes, canaleta, prensa-cabos e fios | R$ 300 | R$ 450 |
| 2 rolos de 30 m de cabo de instrumentação blindado | R$ 334 | sem linha própria |
| Ethernet e pequenos acessórios | R$ 30 | R$ 30 |
| **Base** | **R$ 2.667** | R$ 3.442,11 |

**Saíram da base:** detector de fumaça próprio (a detecção vem da central certificada, NBR 17240),
contator e relé de sobrecarga (a plataforma não comanda a bomba), relé de falta de fase (proteção do
quadro elétrico; o medidor já lê as fases) e contato auxiliar do disjuntor (fora do escopo).

**Módulos por condomínio:** hidrômetro com saída pulsada (3/4": R$ 306–488; 1": R$ 888–1.270),
segundo sensor de nível para a cisterna (R$ 592) e detector de gás com saída a relé (R$ 266–300).

## 8. Fontes

- PUSR: [manual do M100-HM](https://www.pusr.com/uploads/20241205/285a4d714f715d1ad8a693f499136208.pdf),
  [M300](https://www.pusr.com/products/high-performance-edge-IoT-Gateway.html)
- Altus: [catálogo do Nexto Xpress](https://www.altus.com.br/wp-content/uploads/2024/10/Nexto-Xpress-pt-Rev-J.pdf),
  [TLS 1.2 no MQTT](https://www.altus.com.br/en/post/343/clps-da-serie-nexto-contam-com-suporte-a-tls-1-2-para-criptografia-de-mensagens-mqtt/)
- Unitronics: [especificação do USC-B3-R20](https://www.unitronicsplc.com/Documents/UniStream/PLC/SPEC_USC-x3-R20_T20.pdf),
  [MQTT no UniLogic](https://www.unitronicsplc.com/Download/SoftwareHelp/%21UniLogicWebhelp2024/Communications/MQTT.htm),
  [preço na Spectra (Alemanha)](https://unitronics.spectra.de/en/search?search=USC-B3-R20),
  [módulos UAC-CB](https://spectra.de/media/21/ed/82/1630495014/Datasheet-UAC-CB-XXXX_9df91ffe.pdf)
- WEG: [catálogo do PLC410](https://static.weg.net/medias/downloadcenter/h0f/hc6/WEG-PLC.410-brochure-50161419-en.pdf)
- Teltonika: [datasheet do TRB246](https://download.axilogi.com/Teltonika/Datasheet/TRB246.pdf)
- Mercado Livre em 24/10/2026: [USR-M100 e M300](https://lista.mercadolivre.com.br/usr-m100),
  [módulos USR-IO](https://lista.mercadolivre.com.br/pusr-usr-io),
  [Altus Nexto](https://lista.mercadolivre.com.br/clp-altus-nexto),
  [WEG PLC410](https://lista.mercadolivre.com.br/weg-plc410),
  [Siemens S7-1200](https://lista.mercadolivre.com.br/clp-s7-1200-cpu-1212c),
  [Haiwell](https://lista.mercadolivre.com.br/clp-haiwell),
  [Schneider TM200CE24R](https://lista.mercadolivre.com.br/tm200ce24r),
  [sensor de nível](https://lista.mercadolivre.com.br/sensor-nivel-submersivel-4-20ma),
  [DTSU666](https://lista.mercadolivre.com.br/dtsu666),
  [hidrômetros](https://lista.mercadolivre.com.br/hidrometro-saida-pulsada)
