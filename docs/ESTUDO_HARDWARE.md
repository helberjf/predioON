# Estudo de equipamentos: gateway e CLP

Revisão de 25/10/2026 do estudo anterior (pranchas de outubro de 2026). Preços do Mercado Livre em
24 e 25/10/2026, sem frete nem mão de obra, salvo indicação. Cote antes de comprar.

## Conclusão

**O melhor custo-benefício que faz o sistema inteiro funcionar é o gateway PUSR USR-M100-HM-ETH com o
módulo USR-IO8000.** Com os sensores e o quadro, o kit sai por **cerca de R$ 4.563** e cobre todas as
funções do Prédio ON (seção 1). Com todos os módulos opcionais (cisterna, consumo de água e gás),
fica em cerca de R$ 6.600.

Para funcionar de ponta a ponta, faltam três coisas:

1. **Adaptador na plataforma.** O M100 envia um JSON próprio, com várias leituras juntas e horário
   em Unix. A ingestão precisa traduzi-lo para o formato do Prédio ON (seção 5). É desenvolvimento
   feito uma vez, no repositório.
2. **Contador de pulsos para o consumo de água.** Nem o M100 nem o IO8000 contam pulsos. O
   hidrômetro entra por um contador Modbus, o Novus DigiRail-4C, lido no mesmo barramento do medidor
   de energia.
3. **Teste de bancada** com uma unidade antes de comprar em volume (seção 5).

**Por que não o CLP:** gateway e CLP empatam em robustez (3,85 contra 3,80, seção 3), mas o CLP custa
de R$ 2.800 a R$ 4.400 a mais por condomínio, e o Prédio ON não comanda nada no campo. O CLP fica como
linha premium: **Altus Nexto Xpress XP315 ou XP325**, para cliente que exige padrão industrial ou
marca nacional.

**Plano B sem desperdício:** se o M100 falhar na bancada, troca-se só a cabeça pelo USR-M300-GL
(R$ 2.789). O IO8000, os sensores e o quadro servem nos dois.

| Kit | Controlador | Total |
|---|---|---|
| **Recomendado** | M100-HM-ETH + IO8000 + cartão microSD | **≈ R$ 4.563** |
| Recomendado, com cisterna, consumo de água e gás | idem + contador DigiRail-4C | ≈ R$ 6.600 |
| Plano B | M300-GL + IO8000 (sem cartão: o cache é interno) | ≈ R$ 5.970 |
| Premium com CLP | Altus XP315 ou XP325 | ≈ R$ 7.332–8.932 |

## 1. O sistema completo, função por função

| Função na plataforma | Equipamento | Liga em | Preço |
|---|---|---|---|
| Nível da caixa (`water_level_percent`) | Sensor submersível 4–20 mA, inox, 0–5 mca | Entrada analógica 1 do M100 | R$ 592 |
| Energia, tensão e corrente por fase (`energy_total_kwh`, `voltage_l1..l3`) | Medidor trifásico Chint DTSU666, até 80 A direto | RS485 (Modbus) | R$ 600 |
| Temperatura (`temperature_c`) | XY-MD02 | RS485 (Modbus) | R$ 119 |
| Bomba ligada (`pump_running`) | Contato auxiliar do contator existente. Se faltar, bloco auxiliar WEG | Entrada digital | R$ 0–29 |
| Vazamento de água (`water_leak_detected`) | Sensor de alagamento com contato seco | Entrada digital | R$ 136 |
| Vazamento de esgoto (`sewage_leak_detected`) | Segundo sensor de alagamento | Entrada digital | R$ 136 |
| Incêndio (`smoke_detected`) | Contato seco da central existente (NBR 17240) | Entrada digital | só cabo |
| Boias alta e baixa (conferência do nível) | Kit com 2 boias | 2 entradas digitais | R$ 63 |
| Equipamento online/offline | Last will do M100 | MQTT | incluído |
| Leituras durante a queda de internet | Cartão microSD High Endurance 32 GB no M100-HM | Cartão SD | R$ 192 |
| **Módulo:** cisterna | Segundo sensor de nível | Entrada analógica 2 | R$ 592 |
| **Módulo:** consumo de água (`water_total_m3`) | Hidrômetro 3/4" com saída pulsada + contador Novus DigiRail-4C | RS485 (Modbus) | R$ 306–488 + contador (usado: R$ 750; novo, cotar) |
| **Módulo:** gás (`gas_detected`) | Detector 12/24 V com saída a relé | Entrada digital | R$ 266–300 |

**Entradas usadas:** 7 digitais de 10 (2 no M100 e 8 no IO8000), 2 analógicas de 2 e um barramento
RS485 com medidor, temperatura e contador.

**Fora do kit:** portões e vagas (desligados por padrão) e disjuntores e extintores (fora do escopo).

## 2. Por que gateway e não CLP

O equipamento de campo só precisa ler sensores, publicar por MQTT com TLS e guardar leituras na queda
de internet. A bomba é só monitorada, as automações não acionam equipamento
([AUTOMACOES.md](AUTOMACOES.md)) e os portões vêm desligados.

| | CLP (Altus) | Gateway (M100-HM) |
|---|---|---|
| Hardware | Painel industrial, com opção de tropicalização | Industrial, com proteções de ESD, surto e EFT nível 3 |
| Suporte | Fabricante nacional, técnicos conhecem | Fabricante chinês, menos conhecido |
| Nuvem | JSON, fila e reconexão são programa nosso | MQTT, TLS e cache prontos |
| Contagem de pulsos | Nativa (4 entradas rápidas) | Precisa de contador à parte |
| Preço do controlador | R$ 4.500–6.100 | R$ 1.539 |

A leitura percorre uma corrente: sensor → equipamento → internet → plataforma. Os elos que mais
falham são internet, energia e sensores, e o CLP fortalece só o do meio. Ele se paga quando o cliente
exige padrão industrial, quando a oferta incluir alarme local sem internet ou em ambiente agressivo.

## 3. Comparação dos controladores

| Opção | Preço | Formato da plataforma | Cache offline | Perfil custo | Perfil robustez |
|---|---|---|---|---|---|
| **M100-HM + IO8000** | R$ 1.539 | Com adaptador | Sim, cartão SD | **3,90** | 3,85 |
| Teltonika TRB246 + módulos | Fora do Mercado Livre; €131–244 na Europa | Script Lua | A confirmar | 3,70 | **3,90** |
| M300-GL + IO8000 | R$ 3.138 | Node-RED | Anunciado | 3,60 | 3,75 |
| **Altus XP315 / XP325** | R$ 4.500–6.100 | Programando | Por programa | 3,00 | **3,80** |
| WEG PLC410 + MOD2.00 | ≈ R$ 7.180 | Programando | Por programa | 3,00 | 3,80 |
| Siemens S7-1200 + módulos | ≈ R$ 4.800 + licença | MQTT por biblioteca | Por programa | 3,05 | 3,75 |
| Unitronics USC-B3-R20 | €372 + módulo + importação | Programando | Por programa | 2,65 | 3,10 |
| Haiwell A8 + A04XA | R$ 2.615 | Não documentado | Não verificado | 2,75 | 3,00 |
| Schneider M200 + gateway | R$ 1.490–2.100 + extras | Só pelo gateway | Do gateway | 2,55 | 3,35 |

Notas de 1 a 5 em custo, integração, cache offline, operação remota, disponibilidade no Brasil e
robustez. O perfil custo pesa custo em 25% e robustez em 10%. O perfil robustez pesa custo em 10% e
robustez em 30%.

## 4. CLPs da imagem anterior

| CLP | Se enquadra? | Por quê |
|---|---|---|
| Unitronics UniStream USC-B3-R20 | Sim, tecnicamente | MQTT com SSL, last will e JSON; 10 DI, 2 AI 0–20 mA, 8 relés. Precisa do módulo UAC-CB-01RS4 para RS485. Sem venda no Brasil: €372 na Alemanha, e a importação pode quase dobrar |
| Altus XP315 | Sim | 16 DI, 5 AI, RS485, MQTT com TLS 1.2, contador rápido. Fora do Mercado Livre: comprar por distribuidor ou usar o XP325 |
| Haiwell A8 | Parcialmente | MQTT, mas JSON e TLS não documentados |
| Schneider M200 | Não | Sem MQTT |

## 5. O que falta para funcionar

### 5.1 Adaptador na plataforma

O modelo de JSON do M100 aceita constantes, os valores lidos e o horário da amostra (`sys_unix_time`
ou `sys_time`, em GMT). A ingestão precisa de um perfil de gateway que:

- receba o relatório num tópico próprio, como `predio/{buildingId}/gateway/{gatewayId}/report`;
- mapeie cada valor para `deviceId`, métrica e escala em `devices.metadata`;
- converta o horário Unix para ISO 8601 em UTC;
- derive o `eventId` de gateway, ponto e horário, como `services/ingest/src/pipeline/normalize.ts`
  já faz no contrato compacto da caixa d'água;
- converta 0/1 em booleano e descarte leituras com falha, nunca gravando zero;
- conte o relatório como sinal de vida do gateway.

Escrever a partir de um relatório real capturado na bancada.

### 5.2 Bancada

Comprar um M100-HM-ETH, um IO8000, um cartão microSD e uma fonte 24 V, e conferir:

- [ ] TLS 1.2 com o broker de produção, validando o certificado;
- [ ] internet cortada por uma hora: as leituras do cartão SD chegam depois com o horário original;
- [ ] energia cortada: o painel mostra o gateway OFFLINE;
- [ ] leitura 4–20 mA comparada com medição manual em dois níveis;
- [ ] contador DigiRail-4C: a contagem continua certa e, se zerar após falta de energia, a
  plataforma trata como troca de medidor sem gravar consumo falso;
- [ ] reinício sem nenhuma saída acionada.

Se o cache do M100 não preservar o horário, passar ao M300-GL, que reaproveita o IO8000.

## 6. Quadro e infraestrutura

| Item | Preço | Antes |
|---|---|---|
| Fonte 24 V 2,5 A Mean Well MDR-60-24 | R$ 175 | R$ 266 (5 A) |
| 2 × DPS classe II 20 kA 275 V | R$ 90 | R$ 228 (3 da WEG) |
| Disjuntor do circuito de automação | R$ 33 | R$ 33 |
| Caixa metálica 400×300×200 IP65 | R$ 195 | R$ 195 |
| Trilho, bornes, canaleta, prensa-cabos e fios | R$ 300 | R$ 450 |
| 2 rolos de 30 m de cabo de instrumentação blindado | R$ 334 | sem linha própria |
| Ethernet e pequenos acessórios | R$ 30 | R$ 30 |
| **Subtotal** | **R$ 1.157** | |

**Soma do kit recomendado:** sensores e funções da seção 1 (R$ 1.675 sem os módulos) + controlador
(R$ 1.190 do M100-HM-ETH + R$ 349 do IO8000 + R$ 192 do cartão) + quadro (R$ 1.157) = **R$ 4.563**.

**Saíram do estudo anterior:** detector de fumaça próprio (a detecção vem da central certificada),
contator e relé de sobrecarga (a plataforma não comanda a bomba), relé de falta de fase (o medidor já
lê as fases) e contato auxiliar do disjuntor (fora do escopo).

## 7. Fontes

- PUSR: [manual do M100, com o modelo de JSON](https://www.pusr.com/download/USR-M100%20User-Manual_V1.0.1.pdf),
  [manual do M100-HM](https://www.pusr.com/uploads/20241205/285a4d714f715d1ad8a693f499136208.pdf),
  [manual da série USR-IO, com o IO8000](https://www.pusr.com/uploads/20240611/566c67bb606301807c94c4f8bf37d32c.pdf),
  [M300](https://www.pusr.com/products/high-performance-edge-IoT-Gateway.html)
- Novus: [manual do DigiRail-4C](https://www.wolfautomation.com/content/novus-digirail-digitalcounterinput-instructionmanual.pdf)
- Altus: [catálogo do Nexto Xpress](https://www.altus.com.br/wp-content/uploads/2024/10/Nexto-Xpress-pt-Rev-J.pdf),
  [TLS 1.2 no MQTT](https://www.altus.com.br/en/post/343/clps-da-serie-nexto-contam-com-suporte-a-tls-1-2-para-criptografia-de-mensagens-mqtt/)
- Unitronics: [especificação do USC-B3-R20](https://www.unitronicsplc.com/Documents/UniStream/PLC/SPEC_USC-x3-R20_T20.pdf),
  [MQTT no UniLogic](https://www.unitronicsplc.com/Download/SoftwareHelp/%21UniLogicWebhelp2024/Communications/MQTT.htm),
  [preço na Spectra (Alemanha)](https://unitronics.spectra.de/en/search?search=USC-B3-R20)
- WEG: [catálogo do PLC410](https://static.weg.net/medias/downloadcenter/h0f/hc6/WEG-PLC.410-brochure-50161419-en.pdf)
- Teltonika: [datasheet do TRB246](https://download.axilogi.com/Teltonika/Datasheet/TRB246.pdf)
- Mercado Livre: [USR-M100 e M300](https://lista.mercadolivre.com.br/usr-m100),
  [módulos USR-IO](https://lista.mercadolivre.com.br/pusr-usr-io),
  [DigiRail-4C](https://lista.mercadolivre.com.br/digirail-4c),
  [Altus Nexto](https://lista.mercadolivre.com.br/clp-altus-nexto),
  [sensor de nível](https://lista.mercadolivre.com.br/sensor-nivel-submersivel-4-20ma),
  [DTSU666](https://lista.mercadolivre.com.br/dtsu666),
  [hidrômetros](https://lista.mercadolivre.com.br/hidrometro-saida-pulsada),
  [contato auxiliar WEG](https://lista.mercadolivre.com.br/contato-auxiliar-contator-weg-1na),
  [cartão microSD](https://lista.mercadolivre.com.br/cartao-microsd-32gb-high-endurance)
