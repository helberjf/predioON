# Estudo de hardware: menor custo total com monitoramento robusto

Revisão de **04/11/2026**. Escopo confirmado: **somente monitoramento**, incluindo caixa
d'água, cisterna, consumo de água e energia, fases, estado da bomba, temperatura,
vazamentos de água/esgoto, gás e sinal da central de incêndio. Portões e vagas não fazem
parte desta compra.

**Situação:** seleção técnica e orçamento preliminar; nenhum conjunto foi homologado
fisicamente por este estudo. Documentação de fabricante, preço anunciado e teste de
software não substituem o teste com o equipamento e o firmware que serão instalados.

## 1. Decisão recomendada

**Começar com um único piloto PUSR USR-M100-HM-ETH + USR-IO8000, com armazenamento
local, contador de água, proteção elétrica e nobreak. Padronizar esse kit somente se
ele passar pelos testes da seção 7 e continuar sendo o menor custo total.**

A proposta econômica continua sendo um gateway, porque o escopo é adquirir dados e
notificar, sem comandar bombas. O investimento prioritário deve fechar a continuidade
de alimentação, a qualidade dos sensores e a recuperação de dados. Comprar um CLP mais
caro, isoladamente, não resolve esses requisitos.

| Configuração de monitoramento completo | Base preliminar de hardware por instalação | Uso recomendado |
|---|---:|---|
| **M100-HM-ETH + IO8000 + DigiRail-4C novo + SD + nobreak e complementos** | **R$ 7.652–8.168** | Menor custo de partida entre os kits completos calculados; internet existente, com histórico recuperável após a queda |
| Mesmo kit + roteador 4G RUT200 com troca automática de conexão | R$ 9.847–10.363 | Quando os alertas remotos precisam continuar durante falha da internet principal |
| M300-GL + IO8000 + DigiRail-4C novo + nobreak e complementos | R$ 9.059–9.575 | Comparar com o kit anterior se o 4G integrado, o armazenamento e a recuperação forem aprovados |
| Altus XP315 + armazenamento compatível + nobreak e complementos | R$ 10.667–11.183 | Alternativa industrial quando ambiente, manutenção ou custo de integração justificarem o adicional |

**Esses valores não são orçamento instalado nem teto de compra.** Misturam referências
históricas, anúncios consultados nesta revisão e provisões identificadas na seção 3.
Não incluem frete, instalação, desenvolvimento, mensalidades, adequação de sensores
ao local nem aumento de autonomia. O kit M300 usa preço histórico ainda sujeito a cotação.

Sem conexão alternativa, o kit econômico deverá preservar medições enquanto tiver
alimentação, após validar seu armazenamento, mas não envia alertas remotos durante a
indisponibilidade da internet. A plataforma
atual também não transforma automaticamente todo evento antigo em alerta ao reconectar.
Se notificação durante a queda do link for requisito, **incluir o 4G no orçamento desde
o início**. Nenhuma opção promete disponibilidade absoluta.

A preferência por Altus quando a prioridade é robustez industrial permanece válida,
mas **não é a escolha padrão para a nova prioridade de menor gasto com requisitos
atendidos**. Não há ensaio comparativo que permita declarar empate de confiabilidade
entre marcas ou atribuir probabilidade de falha a partir de notas comerciais.

## 2. O que o kit entrega e como dimensionar

Base de comparação: um condomínio com **uma caixa, uma cisterna, uma bomba, um ponto
de medição de água, um ponto de energia trifásica, um ponto de temperatura, dois pontos
de vazamento e um ponto de gás**, além de central de incêndio existente com interface
compatível. Cobrir todas essas funções não significa cobrir fisicamente todas as áreas
do prédio com um único sensor de cada tipo.

Contratos da plataforma: [SENSORES.md](SENSORES.md) e
[HARDWARE_SOFTWARE.md](HARDWARE_SOFTWARE.md). A bomba é monitorada; as
[automações](AUTOMACOES.md) geram ordens de serviço, sem comando de equipamento.

| Função | Equipamento/interface do kit | Condição para cumprir a função |
|---|---|---|
| Nível da caixa | Transmissor submersível 4–20 mA, AI1 | Definir faixa pela altura útil, materiais, precisão e cabo. 0–5 mca é referência, não padrão universal |
| Nível da cisterna | Segundo transmissor 4–20 mA, AI2 | Calibrar separadamente; volume depende da geometria do reservatório |
| Consumo de água | Hidrômetro pulsado + DigiRail-4C em RS485 | Definir litros/pulso, vazão, diâmetro, tipo elétrico e retenção da contagem |
| Energia e fases | Multimedidor Modbus | kWh, tensões e, se contratadas, correntes/frequência. Definir versão, ligação e transformadores de corrente necessários |
| Estado da bomba | Contato auxiliar existente | Publicar `pump_running` conforme o contrato atual: estado do contato. Não afirmar vazão a partir dele |
| Temperatura | Transmissor Modbus, XY-MD02 como referência histórica | Confirmar modelo, precisão, endereço, comunicação e adequação ao ambiente |
| Vazamento de água e esgoto | Dois sensores com saída compatível | Selecionar sondas para o líquido e local; documentar comportamento diante de sujeira, corrosão e falha |
| Gás | Detector para o gás realmente presente, com relé | Calibração, vida útil e alarme local definidos. `gas_ppm` só se o aparelho medir e fornecer esse dado |
| Incêndio | Sinal da central existente | O Prédio ON supervisiona seu sinal; central, detectores e alarmes locais continuam independentes |
| Conferência do nível | Duas boias independentes | Comparação com o nível analógico exige mapeamento e regra de divergência; não está pronta só por conectar as boias |
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
| DI1 a DI7 | Bomba, água, esgoto, incêndio, boia alta, boia baixa e gás |
| DI8 | Diagnóstico de alimentação |
| DI9 e DI10 | Reserva para sinais de falha da central/detector, se disponíveis |
| Contador externo | Um canal de pulsos; não utilizar leitura periódica de DI para contar pulsos |
| RS485 | Medidor de energia, temperatura, contador e expansões conforme topologia do fabricante |

A numeração acima é lógica, não endereço de registrador. Confirmar terminais, tensão,
polaridade e mapa no equipamento real. Um contato seco simples não detecta automaticamente
cabo rompido ou sensor travado; usar diagnóstico do fabricante ou supervisão adicional
quando necessário. Ausência de leitura não pode virar "sem vazamento" ou "sem gás".

## 3. Orçamento comparável e rastreável

Valores em reais. Classificação:

- **H — histórico:** referência da revisão de 25/10/2026, não reconfirmada como oferta
  disponível em 04/11. Deve ser recotada com modelo e garantia definidos.
- **A — anúncio consultado em 04/11/2026:** referência pública, sem reserva de estoque,
  validação de frete ou proposta comercial. Não é garantia do menor preço.
- **P — provisão de projeto:** verba para planejamento, não cotação nem comprovação de
  que todo o material necessário caberá nela.

### 3.1 Sensores e infraestrutura comuns aos kits

| Item | Quantidade/escopo | Total | Origem |
|---|---|---:|---|
| Sensores de nível 4–20 mA | 2 | 1.184 | H |
| Medidor de energia trifásico | 1, versão ainda a dimensionar | 600 | H |
| Temperatura Modbus | 1 | 119 | H |
| Contato auxiliar da bomba | 1; descontar se já houver contato disponível | 29 | H |
| Sensores de vazamento | 2 | 272 | H |
| Boias de conferência | 2 | 63 | H |
| Hidrômetro pulsado | 1, dimensão ainda a confirmar | 306–488 | H |
| Detector de gás com relé | 1; adequação e modelo pendentes | 266–300 | H |
| Fonte Mean Well MDR-60-24, 24 V/2,5 A | 1 | 175 | H |
| Proteção contra surtos na alimentação | Verba histórica; quantidade e tensão conforme projeto | 90 | H |
| Disjuntor da automação | 1 | 33 | H |
| Quadro IP65 400×300×200 | 1, verificar espaço e dissipação | 195 | H |
| Trilho, bornes, canaleta, prensa-cabos e fios | Conjunto | 300 | H |
| Cabo de instrumentação blindado | Referência de 60 m | 334 | H |
| Ethernet e acessórios | Conjunto básico | 30 | H |
| **Subtotal comum** | Inclui cisterna, consumo de água e gás | **3.996–4.212** | |

O sinal da central de incêndio pressupõe interface já disponível; um módulo de interface
novo deve ser cotado. Proteções e comando da bomba existentes permanecem no local:
**medir fases não substitui proteção elétrica da bomba**.

### 3.2 Aquisição e armazenamento

| Alternativa | Composição | Total | Origem |
|---|---|---:|---|
| **M100-HM** | M100-HM-ETH 1.190 + IO8000 349 + microSD High Endurance 192 + DigiRail-4C novo 1.144,23 | **2.875,23** | H + A |
| M300 | M300-GL 2.789 + IO8000 349 + DigiRail-4C novo 1.144,23 | 4.282,23 | H + A |
| Altus | XP315 5.690 + provisão de armazenamento compatível 200 | 5.890 | A + P |

O [DigiRail-4C novo](https://www.equipabr.com/digirail-4c-rs485-novus/p) substitui a
referência de usado de R$ 750. O [XP315 anunciado](https://melhorindustria.com.br/clp-1-eth-1-rs-485-1-can-16-ed-16-sd-5-ea-v/i-e-2-ea-rtd-66.016.101-9)
é usado na comparação atual; o XP325 só se justifica se preço/disponibilidade ou funções
adicionais forem vantajosos. O Altus usa contagem nativa, sem somar IO8000, SD do M100
ou DigiRail-4C. Seu armazenamento e programa devem ser dimensionados e validados.

### 3.3 Continuidade e diagnóstico

| Item | Valor | Origem e condição |
|---|---:|---|
| Nobreak: referência Intelbras ATTIV 600 VA 220 V | 480,88 | A — [loja oficial](https://loja.intelbras.com.br/nobreak-attiv-600va-220v/p); selecionar tensão e forma de onda compatíveis com todas as fontes |
| Complementos de proteção e diagnóstico | 300–600 | P — avaliar proteção de sinal/RS485, fusíveis, interface de falta de alimentação e terminais extras; orçamento final depende do levantamento |
| **Subtotal** | **780,88–1.080,88** | Autonomia ainda não comprovada |

Alimentar pelo nobreak o gateway, módulos, contador, sensores que dependem da fonte,
roteador, ONT/modem e switches necessários ao trajeto. Meta inicial de projeto:
**pelo menos 60 minutos medidos com a carga real**; se o modelo de referência não atender,
substituir ou ampliar e recalcular. VA é capacidade de carga, não autonomia.

Usar ambiente adequado à bateria; não presumir que nobreak e bateria cabem no quadro
fechado ou toleram seu aquecimento. A fonte de 2,5 A só permanece se o balanço de cargas,
partidas e margem definidos pelo instalador permitir. Não ligar motores ao nobreak do kit.

### 3.4 Totais e diferenças

A soma do kit M100 é: subtotal comum + aquisição/armazenamento + continuidade =
**R$ 7.652,11–8.168,11**. Para planejamento, aproximadamente **R$ 7,7–8,2 mil em hardware**,
antes das adequações do local e demais despesas.

O adicional de hardware do M300 é **R$ 1.407** sobre o M100. O do XP315, incluindo a
provisão de armazenamento e retirando o contador externo, é **R$ 3.014,77**. Comparar
também o custo de programação, manutenção e deslocamentos, não só essa diferença.

Conexão alternativa: referência de **R$ 2.194,81** para
[RUT200](https://www.rsautomacao.com/rut200-roteador-4gwi-fi-teltonika), anúncio com
estoque indicado na consulta, sem usar desconto Pix na soma. O kit M100 com esse
roteador soma **R$ 9.846,92–10.362,92**, mais SIM/plano de dados e eventuais antena/montagem.
O fabricante documenta
[troca automática de conexão](https://www.teltonika-networks.com/products/routers/rut200).
Testar queda com cabo ainda conectado, pois link Ethernet ativo não prova internet funcionando.

**Se o 4G for necessário, recotar M100 + roteador e M300-GL com o mesmo escopo.**
Nesta base, o M300 fica abaixo do conjunto separado, mas seu preço é histórico e não
comprova uma economia disponível para compra. Ele pode reunir funções e reduzir
equipamentos, desde que variante celular, firmware, troca de link, persistência e
integração passem na bancada. Não assumir equivalência entre variantes M100, M100-HM e M300.

### 3.5 Custo total em três anos

Para cada proposta aprovada tecnicamente, preencher:

> Custo total = hardware adequado ao local + frete + montagem/instalação/comissionamento
> + desenvolvimento e homologação rateados pelo número de instalações
> + 36 × custos mensais atribuíveis + manutenção e reposições previstas + visitas técnicas.

Custos mensais incluem conexão móvel, hospedagem/backup da plataforma e serviços pagos
de notificação/gestão remota quando utilizados. Software compartilhado não deve ser
cobrado integralmente em cada condomínio nem tratado como gratuito no primeiro piloto.
Não estimar quantidade de falhas sem dados; comparar cenários de visitas e horas de suporte.

**Regra de decisão:** escolher o menor custo total entre os conjuntos que atendam aos
requisitos. Uma opção mais cara pode compensar se reduzir comprovadamente integração,
suporte ou visitas em valor maior que o adicional.

## 4. Onde reduzir custo sem retirar funções

1. **Reaproveitar equipamentos existentes compatíveis.** Levantar medidor Modbus,
   hidrômetro com saída utilizável, contato auxiliar, central de incêndio, nobreak com
   capacidade disponível, fonte e infraestrutura. Não contabilizar economia antes de
   verificar disponibilidade, estado, interface e autonomia.
2. **Cotar hidrômetro com totalizador Modbus nativo.** O conjunto pulsado + DigiRail-4C
   custa R$ 1.450,23–1.632,23 nesta base. Um medidor de dimensão equivalente, com total
   acumulado persistente e interface incluída, reduz custo se sua proposta instalada
   ficar abaixo da alternativa pulsada instalada. Não confundir RS485 com garantia de
   protocolo Modbus nem eliminar o contador antes de aprovar a alternativa.
3. **Avaliar NOVUS DigiRail IoT ETH na mesma rodada de cotação.** Há anúncio de
   [R$ 2.600, ou R$ 2.470 à vista](https://www.nobrebrasil.com/automacao-industrial).
   O modelo reúne contagem de pulsos e aquisição, podendo retirar o DigiRail-4C separado.
   Porém, suas 6 DI, 2 AI e 8 canais remotos não comprovam cobertura de todo o kit.
   Dimensionar a expansão digital, todas as métricas e o histórico antes de calcular
   economia. Não recomendar um segundo gateway apenas para contornar limite sem comparar o custo.
4. **Não comprar CLP nem saída analógica sem necessidade.** Manter o XP315 como
   alternativa, sem pagar automaticamente pelo XP325. Não comprar contator novo para
   uma bomba que será apenas monitorada.
5. **Padronizar após o piloto.** Uma configuração reproduzível, mapa de registros,
   firmware fixado, backup e instruções de troca reduzem custo operacional. Material
   usado sem procedência e sensores sem modelo definido não são referência para um kit robusto.

## 5. Comparação técnica sem notas artificiais

| Alternativa | Evidência disponível | Pendência decisiva | Papel na decisão |
|---|---|---|---|
| M100-HM + IO8000 | Manual documenta MQTT/TLS e cache em SD; expansão digital documentada | JSON real, persistência após corte durante gravação, horário original e reenvio ordenado | Primeiro candidato econômico |
| M300-GL + IO8000 | Fabricante anuncia Node-RED, armazenamento e conectividade celular | Demonstrar durabilidade da fila, TLS, variante celular e retomada; mais recursos não significam menos falhas | Candidato quando integração/4G justificarem |
| NOVUS DigiRail IoT ETH | Manual documenta pulsos, MQTT, canais remotos e capacidade do buffer | Cobertura de entradas/métricas e autonomia do histórico na configuração completa | Concorrente a cotar, não substituto já aprovado |
| Teltonika TRB246 + módulos | Boa documentação de conectividade e envio de dados | Suporte discutiu banco Modbus em RAM; confirmar retenção após falta de energia na versão escolhida | Alternativa de comunicação, sem presumir fila persistente |
| Altus XP315 | Recursos industriais, entradas, contagem e MQTT/TLS documentados | Programa, fila persistente, sincronização e recuperação ainda precisam ser entregues | Alternativa industrial, com custo maior |

No NOVUS, energia acumulada + três tensões + três correntes + temperatura já ocupam
oito canais remotos se cada grandeza usar um canal. Ainda faltaria mapear expansão de
entradas. Não retirar silenciosamente medições para fazer a alternativa parecer equivalente.
As correntes são opcionais no contrato atual: um perfil explicitamente sem elas libera
canais para expansão e merece cotação. A entrada usada para pulsos também deve entrar
na conta das seis DI; confirmar o mapa completo antes de aprovar essa redução de custo.
O manual também limita o buffer conforme canais habilitados; a autonomia deve ser
calculada pela configuração completa, incluindo eventos. Entradas/interfaces não isoladas
exigem atenção ao projeto, independentemente de a marca ser nacional.

As opções WEG PLC410, Siemens S7-1200, Unitronics, Haiwell e Schneider M200 permanecem
fora da primeira compra por não haver, nesta revisão, proposta completa comparável
que demonstre menor custo atendendo aos requisitos. Isso não é uma classificação
geral de qualidade dessas marcas. Reabrir a comparação se um integrador apresentar
kit equivalente com fornecimento, suporte, software e homologação incluídos.

## 6. Trabalho de integração ainda necessário

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
| Qualidade e diagnóstico | Nunca converter timeout, falha Modbus, cabo rompido ou valor de erro em zero/normal; distinguir comunicação do gateway da saúde do sensor |
| Consumo e reenvio | Preservar ordem por dispositivo/métrica ou implementar recomposição do consumo; provar totais após reconexão e virada do dia |
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

As regras de telemetria não disparam alertas para leituras com mais de cinco minutos.
Definir essa diferença entre histórico e incidente atual na operação. O Last Will depende
de o broker detectar a desconexão, inclusive pelo keepalive; não é detecção instantânea
de falta de energia nem identifica sozinho sua causa.

## 7. Critérios de aceitação antes de comprar em volume

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
| Contagem de água | Aplicar quantidade conhecida de pulsos, reconectar e reiniciar; total conferido e escala correta. Documentar retenção e comportamento após perda completa de alimentação |
| Consumo recuperado | Totais corretos após interrupção, reenvio fora de ordem, duplicação, virada de dia e reinício de contador; sem consumo fictício |
| Falha de sensor/RS485 | Interromper um dispositivo/cabo e simular erro; não aparecer "normal" ou zero inventado; dispositivos saudáveis continuam sendo lidos |
| Nível e boias | Conferir nível em pelo menos três pontos e demonstrar divergência entre boia e analógico sem afetar o comando local da bomba |
| Alarmes e estados | Simular contatos de água, esgoto, gás, central e alimentação; medir tempo até painel/notificação e confirmar comportamento offline |
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

## 8. Sequência de compra e implantação

1. Levantar pontos, distâncias, ambiente, rede elétrica, internet e equipamentos existentes.
   Fixar se é aceitável perder notificações remotas temporariamente por queda de link.
2. Recotar o kit M100 e as alternativas aplicáveis com **mesmo escopo**, incluindo peças
   novas, garantia, substituição, integração e comissionamento. Verificar variante/firmware.
3. Comprar ou obter para avaliação **um conjunto**, concluir o adaptador e executar a bancada.
   A bancada mínima M100 + IO8000 + SD + fonte soma R$ 1.906 nas referências históricas;
   com contador novo e nobreak, R$ 3.531,11, ainda sem todos os sensores e acessórios.
4. Reaproveitar esse conjunto no primeiro condomínio somente depois da aprovação.
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

## 9. Fontes e limites da revisão

Documentação técnica consultada em 04/11/2026; conferir a revisão correspondente ao
equipamento efetivamente entregue:

- [PUSR M100-HM: MQTT/TLS, SD e variantes](https://www.pusr.com/uploads/20241205/285a4d714f715d1ad8a693f499136208.pdf).
- [PUSR M100: modelo de JSON](https://www.pusr.com/download/USR-M100%20User-Manual_V1.0.1.pdf).
  Não presumir que todos os recursos desse manual existam em qualquer firmware HM.
- [PUSR USR-IO: entradas e interfaces](https://www.pusr.com/uploads/20240611/566c67bb606301807c94c4f8bf37d32c.pdf).
- [PUSR M300: recursos anunciados](https://www.pusr.com/products/industrial-IoT-Gateway.html).
- [NOVUS DigiRail-4C: manual de instalação](https://www.wolfautomation.com/content/novus-digirail-digitalcounterinput-instructionmanual.pdf)
  e [manual de comunicação do fabricante, hospedado por distribuidor](https://cdn02.duxcloud.com.br/exsense/products/43/files/manual-de-comunicacao-L5p7c0Kz.pdf).
- [NOVUS DigiRail IoT: canais, isolamento e buffer](https://cdn.novusautomation.com/downloads/manual_digirail_iot_v10x_en.pdf).
- [Altus Nexto Xpress: interfaces, contagem e recursos industriais](https://www.altus.com.br/wp-content/uploads/2024/10/Nexto-Xpress-pt-Rev-J.pdf)
  e [MQTT com TLS 1.2](https://www.altus.com.br/en/post/343/clps-da-serie-nexto-contam-com-suporte-a-tls-1-2-para-criptografia-de-mensagens-mqtt/).
- [Teltonika TRB246: envio de dados](https://wiki.teltonika-networks.com/view/TRB246_Data_to_Server)
  e [discussão do suporte sobre buffer Modbus e persistência](https://community.teltonika.lt/t/trb145-trb246-modbus-data-buffering-during-connectivity-loss-ram-database-capped-at-1-3-mb-moving-it-to-flash-via-uci-works-is-it-supported/21167).
  Relatos e orientações referem-se às versões discutidas; validar a versão escolhida.
- Preços novos: anúncios de DigiRail-4C, XP315, ATTIV 600, RUT200 e DigiRail IoT
  vinculados nas seções 3 e 4. Os demais valores vêm da revisão anterior, sem confirmação
  comercial nesta data.

Esta revisão retira as notas ponderadas apresentadas como empate de robustez, a
afirmação de funcionamento completo antes da integração e a referência de contador usado
como base de produção. Mantém o M100 como candidato econômico, acrescentando escopo
completo de monitoramento, alimentação de reserva, custos comparáveis e critérios de aprovação.
