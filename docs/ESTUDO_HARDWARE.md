# Estudo de hardware: menor custo total com monitoramento robusto

Revisão de **04/11/2026**. Escopo confirmado: **somente monitoramento**, incluindo caixa
d'água, cisterna, consumo de água e energia, fases, estado da bomba, temperatura,
vazamentos de água/esgoto, gás e sinal da central de incêndio. Portões e vagas não fazem
parte desta compra. O piloto será instalado em um condomínio. Tensão, dimensões,
tubulação, gás e demais dados do local permanecem **para preencher** na
[lista de compras do piloto](COMPRAS_PILOTO.md), que reúne modelos, quantidades,
preços, links, condições e alternativas desta revisão.

**Situação:** seleção técnica e orçamento preliminar; nenhum conjunto foi homologado
fisicamente por este estudo. Documentação de fabricante, preço anunciado e teste de
software não substituem o teste com o equipamento e o firmware que serão instalados.

## 1. Decisão recomendada

**Validar um piloto PUSR USR-M100-HM-GL + USR-IO8000, com cartão, contador de água,
fonte de procedência, proteção elétrica e nobreak.** O 4G integrado é a primeira
opção para reduzir interrupções dos alertas remotos sem o custo de um roteador
separado. Sua troca de conexão precisa funcionar também quando a internet cai e
o cabo Ethernet continua conectado.

A versão **HM-ETH** continua sendo a opção de menor gasto quando há conexão
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
de falhas. A compra em escala depende dos testes da seção 7.

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
[automações](AUTOMACOES.md) geram ordens de serviço, sem comando de equipamento.

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

## 3. Orçamento comparável e rastreável

A [lista de compras](COMPRAS_PILOTO.md) é a referência comercial desta revisão.
Ela distingue **A — anúncio consultado**, **R — referência sem oferta disponível**,
**C — cotação pendente** e **P — provisão estimada**. Preços anunciados não equivalem
a reserva de estoque, adequação da versão ao local ou proposta de instalação.

### 3.1 Composição do cenário com 4G

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

### 3.2 Continuidade, diagnóstico e alternativas

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

### 3.3 Custo total em três anos

Para cada proposta tecnicamente aprovada, preencher:

> Custo total = materiais adequados ao local + frete + montagem/instalação/comissionamento
> + desenvolvimento e homologação rateados pelo número de instalações
> + 36 × custos mensais atribuíveis + manutenção e reposições previstas + visitas técnicas.

Mensalidades incluem conexão móvel, hospedagem/backup e serviços de notificação/gestão
utilizados. Software compartilhado não deve ser cobrado integralmente em cada prédio
nem tratado como gratuito no piloto. Não estimar taxas de falha sem dados.

**Escolher o menor custo total entre os conjuntos que cumpram os requisitos.**
O quadro de preenchimento do custo instalado está na seção 4 da lista de compras.

## 4. Onde reduzir custo sem retirar funções

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

## 5. Comparação técnica sem notas artificiais

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

## 8. Sequência de compra e implantação

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

## 9. Fontes e limites da revisão

Documentação técnica consultada em 04/11/2026; conferir a revisão correspondente ao
equipamento efetivamente entregue:

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
