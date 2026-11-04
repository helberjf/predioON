# Lista de compras do piloto de monitoramento

Revisão de **04/11/2026** para **instalação em um condomínio**. Escopo: somente
monitoramento. Os dados do local ficam **para preencher**, conforme solicitado.
Esta lista atualiza os preços e o dimensionamento do [estudo de hardware](ESTUDO_HARDWARE.md).

**Escolha recomendada:** PUSR **USR-M100-HM-GL**, expansão **IO8000**, armazenamento
local, contagem dedicada de água, fonte de procedência, nobreak e sensores cabeados.
O 4G integrado acrescenta R$ 681,03 sobre o HM-ETH e merece prioridade para manter
alertas quando a internet do condomínio falhar. Essa escolha é uma avaliação de
custo e recursos; depende da aprovação da troca de conexão, do histórico e da integração.

**Referência de materiais: aproximadamente R$ 10,8–12 mil**, no cenário da seção 4.
Não é orçamento instalado: inclui preços condicionais, um contador sem estoque confirmado,
o valor inicial de sondas ainda não configuradas e verbas estimadas de infraestrutura.
Instalação, integração e adequações do local precisam entrar no fechamento.

## 1. Quantidades e dados do condomínio

A base é **uma caixa, uma cisterna, uma bomba, um hidrômetro, um ponto de energia
trifásica, um ponto de temperatura, dois pontos de vazamento e um ponto de gás**,
mais o sinal de uma central de incêndio existente. Isso cobre as funções do piloto;
a quantidade para cobrir todas as áreas do condomínio depende do levantamento.

| Campo | Preencher antes de fechar os modelos |
|---|---|
| Condomínio, endereço e responsável | **Para preencher** |
| Tensão no quadro e fases disponíveis | **Para preencher**: fase-neutro, fase-fase, frequência e neutro disponível |
| Corrente máxima do circuito medido | **Para preencher**: ligação direta ou transformadores de corrente (TCs) |
| Caixa | **Para preencher**: altura útil, formato, volume, acesso e distância até o quadro |
| Cisterna | **Para preencher**: altura útil, formato, volume, acesso e distância até o quadro |
| Água | **Para preencher**: diâmetro, vazões mínima/normal/máxima, pressão, hidrômetro existente e litros por pulso |
| Gás | **Para preencher**: GLP/GN, ambiente, pontos de risco e quantidade/posição de detectores |
| Vazamentos | **Para preencher**: localização dos dois pontos, líquido, sujeira e área efetivamente coberta |
| Bomba | **Para preencher**: modelo do contator e contato auxiliar livre; quantidade de bombas |
| Central de incêndio | **Para preencher**: marca/modelo, relé de alarme, relé de falha e interface autorizada pelo fabricante |
| Internet e telefonia móvel | **Para preencher**: conexão existente, operadora, sinal no quadro/antena e plano de dados |
| Ambiente e infraestrutura | **Para preencher**: temperatura, umidade/condensação, distâncias, eletrodutos, aterramento e proteção existente |
| Continuidade | **Para preencher**: autonomia exigida e prazo de atendimento; meta inicial proposta de 60 min com a carga real |
| Reaproveitamento | **Para preencher**: medidores, fonte, nobreak, quadro, rede e sensores existentes aprovados |

## 2. Equipamentos com modelos e links

Valores em reais, sem frete. **A** = anúncio consultado nesta data, sujeito a estoque,
variação e confirmação da versão. **R** = referência que não representa oferta disponível.
**C** = cotação necessária. O total usa o preço normal anunciado, sem misturar descontos
de meios de pagamento. Descontos visíveis são informados separadamente.

| Item e modelo | Qtd. | Unitário normal | Total usado | Condição e link |
|---|---:|---:|---:|---|
| Gateway **PUSR USR-M100-HM-GL** | 1 | 1.845,45 | 1.845,45 | A — [GMB][g-gl]; Pix 1.753,18. Confirmar variante global, firmware, antena e documentação aplicável à unidade celular |
| Expansão digital **PUSR USR-IO8000** | 1 | 341,50 | 341,50 | A — [GMB][g-io]; Pix 324,42. Confirmar compatibilidade com o gateway fornecido |
| microSD **Kingston High Endurance SDCE/32GB** | 1 | 329,40 | 329,40 | A — [Pichau][sd]; Pix 279,99. Validar formato/capacidade aceitos pelo firmware e procedência |
| Contador **NOVUS DigiRail-4C, 8811400101**, novo | 1 | 1.144,23 | 1.144,23 | **R — [EquipaBR][counter] mostra produto esgotado**. Recotar na [PID Brasil][counter-quote]; não existe estoque reservado |
| Fonte **Mean Well MDR-60-24**, 24 V, 2,5 A | 1 | 205,66 | 205,66 | A — [Mean Well by LRI][psu]; à vista 199,49. Não substituir por anúncio “tipo Mean Well” |
| Nobreak **Intelbras ATTIV 600 VA, 220 V, 4822201** | 1 | 480,88 | 480,88 | A — [loja oficial][ups]. **Referência 220 V**; tensão definitiva para preencher, autonomia a medir |
| Nível **Megga MGG-TNH-SUB**, 4–20 mA, dois fios | 2 | C — a partir de 880,00 | **Fora deste subtotal** | [Aclon][level-shop]. Há versões “sem cabo”: cotar faixa, cabo ventilado completo e materiais para a água do local |
| Energia **CHINT DTSU666, 313280**, direto 80 A | 1 | 618,50 | 618,50 | A — [Coopera][energy]; à vista 575,21. **Referência 3×220/400 V**; não liberar para rede/corrente ainda desconhecidas |
| Temperatura **XY-MD02**, RS485, unidade OEM | 1 | 115,90 | 115,90 | A — [Smart Componentes][temp]; Pix 104,31. Opção econômica somente para ambiente interno compatível, após conferência da versão e leitura |
| Hidrômetro multijato 3/4", 5 m³/h + **Reed V4 Colibri Saga**, kit 17665/17714 | 1 kit | 398,00 | 398,00 | A — [Hidrauconex][water]; à vista 358,20. Inclui medidor e emissor; diâmetro/vazão/pulso ainda para preencher |
| Boias **Eicos LA16M-40** | 4 | 51,00 | 204,00 | A — [Flussen][float]. Duas por reservatório, uma alta e uma baixa; confirmar montagem, material e vedação |
| Adaptadores **PVC M16×25** das boias | 4 | 5,00 | 20,00 | A — [Flussen][float-adapter]. Trocar por fixação apropriada se o reservatório exigir |
| Vazamento **Dwyer WD3-LP-D2**, sem sufixo A | 2 | 727,13 | 1.454,26 | A — [Mercato][leak], **por encomenda**. Cotação alternativa Innovar EL00 antes de fechar, conforme seção 3 |
| Gás **Segurimax 42961**, convencional 12/24 V, relé | 1 | 290,00 | 290,00 | A — [Viver com Segurança][gas-shop], por encomenda. Cadastro da loja diverge na marca: confirmar Segurimax e código 42961 na proposta |
| Quadro **Schuhmacher Multiplast 210640**, 400×300×200 | 1 | 219,66 | 219,66 | A — [Premier Elétrica][box]; Pix 208,68. Preço exibido na consulta indexada; confirmar no orçamento. Verificar espaço e dissipação antes de fechar |
| **Subtotal das referências acima, sem as duas sondas** | | | **7.667,44** | **Inclui R$ 1.144,23 de contador sem estoque confirmado**; não representa carrinho pronto |

O subtotal dos anúncios, retirando o contador esgotado, é **R$ 6.523,21**. Mesmo nesses
anúncios, tensão, dimensionamento, aplicação e prazo continuam sujeitos às condições
de cada linha. Não foram efetuadas compras nem contatos com fornecedores.

### Materiais de instalação ainda a dimensionar

As verbas **P** abaixo são estimativas de planejamento, não preços pesquisados de um
kit pronto. Quantidades finais, códigos e comprimentos serão fechados pelo instalador.
O quadro, a fonte e o nobreak já constam da tabela anterior e não são somados novamente.

| Material | Quantidade prevista | Modelo ou especificação a fechar | Verba total P |
|---|---|---|---:|
| Montagem interna e distribuição 24 V | 1 conjunto | Trilho DIN 35, canaleta, bornes identificados, fusíveis por circuito, terminais e prensa-cabos | 250–400 |
| Cabos de campo e encaminhamento básico | Referência inicial de 60 m, **para preencher** | Cabo de instrumentação/RS485 adequado a cada circuito; não inclui emenda de cabo ventilado submersível | 350–600 |
| Proteção da alimentação | 1 conjunto | Disjuntor da linha WEG MDW ou equivalente; DPS coordenado com a instalação, tensão e polos para preencher | 200–350 |
| Proteção dos sinais e comunicação | 1 conjunto dimensionado por trajeto | Proteger os dois laços 4–20 mA e os trechos RS485 expostos conforme projeto; prever isolamento adicional quando necessário | 350–800 |
| Diagnóstico de falta de rede | 1 conjunto | Relé **Finder 40.52 + base 95.05**, bobina AC adequada à tensão, ou supervisão equivalente aprovada | 100–180 |
| Contato auxiliar da bomba | 1, se não existir livre | Código compatível com o contator existente, **para preencher** | 40–100 |
| Rede Ethernet e acessórios | 1 conjunto básico | Comprimentos/conectores para preencher; switch adicional, se necessário, cotado à parte | 30–80 |
| **Subtotal de provisões** | | | **1.320–2.510** |

Projetos com trajetos longos, exposição a surtos, novas prumadas ou aterramento a
adequar podem superar essas verbas. O nobreak fica em posição ventilada e acessível;
não se presume que ele ou sua bateria caibam dentro do quadro de automação.

## 3. Confiabilidade e custo por equipamento

### Gateway e conexão

O [manual M100-HM][manual-m100], seções 3.1.2, 3.1.4 e 3.1.10, documenta prioridade de
rede e cache em cartão. O cache vem desabilitado na configuração descrita. A tabela de
variantes inclui bandas B3/B7/B28 no modelo global. A designação comercial, o firmware e
a antena do produto entregue devem corresponder à variante avaliada.

O 4G integrado reduz o número de peças e o custo frente a um roteador separado, mas
não elimina o gateway como ponto único de falha. Testar perda da internet **com o cabo
Ethernet ainda conectado**, retorno à conexão principal e gravação durante a transição.
A confirmação de homologação aplicável deve acompanhar a cotação da unidade celular.

| Alternativa | Preço de referência do equipamento | Decisão para este piloto |
|---|---:|---|
| [M100-HM-ETH][g-eth] | 1.164,42; Pix 1.106,19 | Menor gasto; economiza **681,03**. Escolher se houver conexão alternativa existente ou se a indisponibilidade temporária dos alertas remotos for aceitável |
| **[M100-HM-GL][g-gl]** | **1.845,45** | **Melhor equilíbrio proposto** entre preço e continuidade de comunicação; primeiro candidato a validar |
| [M300-ETH][g-m300] | 1.937,43; Pix 1.840,56 | Avaliar se os recursos de programação reduzirem o custo de integração; esta versão não inclui o 4G do GL |
| [NOVUS DigiRail IoT ETH][g-novus] | 2.600,00; à vista 2.470,00 | Pode dispensar contador externo, mas precisa comprovar canais e histórico do conjunto completo |
| [Altus XP315][g-altus] | 5.690,00 | Candidato industrial com mais recursos locais; exige programa e recuperação de dados. Sem evidência para dizer que o conjunto inteiro falhará menos |

**Esses preços não são totais de kits equivalentes.** Expansões, armazenamento,
conectividade, interfaces e desenvolvimento precisam ser somados em cada arquitetura.
Pelo [manual DigiRail IoT][manual-iot], a configuração de seis DI e duas AI comporta
1.824 registros: a cada minuto, são **30,4 horas**, antes de incluir canais remotos e
eventos. A cadência alternativa reduz frequência quando a fila cresce, se habilitada.
Isso não comprova a meta proposta de 72 h de histórico. As interfaces também não são
isoladas entre si. Com quatro boias, são dez estados digitais no piloto; acrescentar
o pulso deixa a expansão ainda mais relevante. Não aprovar a troca apenas pelo preço.

### Nível e conferência independente

As duas sondas fornecem nível contínuo. As **quatro boias** permitem confrontar os
extremos de cada reservatório com a medição analógica. Não comandam a bomba por este
sistema. A fixação deve ser aprovada para o reservatório, sem alterar seu comando local.

O [catálogo Megga][manual-level] identifica saída 4–20 mA, cabo ventilado, materiais
inox 316/316L e IP68. Porém, há divergências entre as páginas sobre consumo e precisão;
pedir ficha revisada da configuração ofertada. Não interpretar inox como comprovação
automática de adequação de todos os materiais à água potável. Confirmar cabo, vedações,
óleo de enchimento, faixa e proteção da extremidade de respiro contra umidade.

**MGG-TNH-SUB é o candidato para cotação econômica com fabricante identificado.**
Se a aplicação exigir comprovação específica para água potável que ele não fornecer,
cotar **WIKA LH-20 com a opção apropriada**: a [ficha WIKA][manual-wika] documenta opções
KTW/ACS. Essa é uma vantagem documental, sem preço nacional confirmado nesta revisão.
O DY20L genérico não entra como substituição automática apenas por custar menos.

### Vazamento e gás

O [fabricante Dwyer][manual-leak] diferencia os modelos: **WD3-LP-D2 sem sirene é IP68**;
o **WD3-LP-D2-A com sirene** tem vedação somente até três quartos da altura do corpo.
O título do anúncio da Mercato menciona buzzer apesar do código sem A. Comprar pelo
código confirmado na proposta, e não pelo título. Há relé e alimentação compatível
com 24 V. A especificação é para água/líquidos condutivos, de 0 a 50 °C.

**Antes de fechar os dois Dwyer, cotar Innovar EL00**. Seu [manual][manual-el00]
documenta alimentação 24 VAC/VDC e relé NA/NF; não foi encontrado preço público
confirmado. É uma oportunidade concreta de redução, desde que proteção, diagnóstico,
sonda e adequação ao líquido atendam ao local. Cada redução de R$ 100 por sensor
reduz o kit em R$ 200. Para esgoto, validar sujeira, incrustação e limpeza; a aplicação
é detectar derramamento no ponto escolhido, não garantir cobertura de toda a tubulação.

O [Segurimax 42961][manual-gas] fornece relé NA e alarme local, mas é **IP20**. Não serve
automaticamente a áreas molhadas, externas ou que exijam detector específico para
atmosfera explosiva. Definir local e gás, prazo de substituição e procedimento de teste
do fabricante. Publicar `gas_detected`; não inventar `gas_ppm`. O alarme local permanece
independente da internet. Um contato NA simples não denuncia sozinho cabo rompido.

### Água, energia, temperatura e alimentação

- **Água:** o kit citado inclui o emissor, diferentemente de um medidor apenas
  “pré-equipado”. O [DigiRail-4C][manual-counter] é contador dedicado de 32 bits, com
  isolamento entre entradas e alimentação/serial, mas não entre todos os circuitos.
  A “retenção de pulsos em intervalo” descrita não comprova retenção do total após corte
  de alimentação. Exigir confirmação e ensaio. Pulsos após esgotar o nobreak podem se
  perder; conferir também o total mecânico. Um hidrômetro Modbus com acumulador autônomo
  pode reduzir peças e esse risco, se adequado ao diâmetro e cotado com interface incluída.
- **Energia:** o [313280 na família CHINT][manual-energy] é uma versão específica.
  Para 127/220 V ou correntes maiores, cotar outra versão apropriada, eventualmente
  com três TCs. Não trocar a versão sem mapa Modbus, relação de transformação e
  compatibilidade elétrica. Priorizar reaproveitamento de multimedidor existente.
- **Temperatura:** XY-MD02 é a concessão econômica para monitoramento ambiental de
  baixa criticidade. O anúncio atual declara SHT40, enquanto circulam manuais de
  variantes SHT20. Não há base para equipará-lo à robustez de um transmissor industrial.
  Se a versão não vier documentada ou houver ambiente inadequado, cotar **NOVUS
  RHT-WM-485-LCD**, com [manual do fabricante][manual-temp], e substituir a linha de preço.
- **Fonte:** a [MDR-60-24][manual-psu] tem proteções e curva de redução de potência
  com temperatura documentadas. Dimensionar consumo de todos os equipamentos,
  inclusive alarmes e transmissão celular. Seu contato **DC OK** monitora a saída;
  atrás do nobreak, ele não identifica sozinho a falta de rede. Por isso há uma
  interface de diagnóstico separada na provisão.
- **Nobreak:** sustentar fonte, módulos, sensores e os equipamentos de rede necessários,
  inclusive ONT e switch quando utilizados. Medir autonomia e retomada com carga real.
  Não concluir autonomia a partir de “600 VA”. O medidor de energia deve medir o
  circuito previsto, e não somente a saída estabilizada do nobreak.

## 4. Custo total e economias que preservam funções

O fechamento correto, com 4G, é:

> **Materiais = R$ 6.523,21 + contador recotado + duas sondas completas cotadas
> + infraestrutura cotada + diferenças das versões necessárias ao condomínio.**

Como cenário, usando o contador a R$ 1.144,23, duas sondas a R$ 880 e as provisões
de R$ 1.320–2.510, obtém-se **R$ 10.747,44–11.937,44**. O preço inicial das sondas
**não comprova fornecimento com cabo**, e o contador aparece esgotado: essa faixa
é apenas planejamento, aproximadamente **R$ 10,8–12 mil**, não teto de implantação.
Com HM-ETH, o mesmo cenário cai para **R$ 10.066,41–11.256,41**, com a diferença de
continuidade de comunicação explicada acima.

| Parcela do sistema instalado | Valor a preencher |
|---|---|
| Materiais com versões e quantidades definitivas | R$ **Para preencher** |
| Frete, tributos adicionais se aplicáveis e prazo | R$ **Para preencher** |
| TCs, módulos da central, ampliação de sensores e rede, se necessários | R$ **Para preencher** |
| Adequações elétricas/hidráulicas, eletrodutos e montagem | R$ **Para preencher** |
| Instalação, calibração e comissionamento em campo | R$ **Para preencher** |
| Adaptador do gateway, regras adicionais e homologação | R$ **Para preencher** |
| SIM/antena adicional e mensalidade de dados | R$ **Para preencher** + R$ **Para preencher**/mês |
| Hospedagem, backup, notificações e manutenção atribuíveis | R$ **Para preencher**/mês |
| **Total instalado e custo em 36 meses** | **Para preencher após consolidar as linhas anteriores** |

Prioridades de economia:

1. **Usar o 4G do HM-GL antes de acrescentar roteador separado**, se aprovado no local.
2. **Reaproveitar medidores, contato auxiliar, infraestrutura e nobreak aprovados**;
   não comprar contator ou equipamento de comando para apenas observar a bomba.
3. **Comparar hidrômetro Modbus nativo** com o conjunto pulsado: a referência deste
   último é R$ **1.542,23** (398 + 1.144,23), antes da instalação. A comparação precisa
   usar o mesmo diâmetro, vazão e escopo; preço menor não basta sem total persistente.
4. **Cotar EL00 e negociar os sensores**, mantendo interfaces e ensaios. O preço dos
   dois Dwyer pesa mais que o adicional de 4G, portanto merece comparação comercial.
5. **Evitar CLP mais caro sem benefício necessário**. Gastar em proteção, alimentação,
   instalação e diagnóstico resolve riscos que a marca do controlador não elimina.

## 5. Entradas e integração com o código

| Recurso | Uso lógico proposto |
|---|---|
| Duas AI do M100 | Nível da caixa e da cisterna |
| Dez DI do M100 + IO8000 | Bomba, água, esgoto, gás, alarme de incêndio, quatro boias e falta de rede |
| DigiRail-4C | Um canal para pulsos. Outros três podem receber estados adicionais conforme mapa e compatibilidade elétrica |
| Diagnósticos adicionais | Falha da central/detector/DC OK, se disponíveis: mapear em canais livres do contador ou acrescentar expansão |
| RS485 | Contador, energia e temperatura, com endereços únicos e parâmetros compatíveis |

**As dez DI principais ficam ocupadas.** Não há duas reservas como na versão do
estudo com apenas duas boias. A numeração é lógica; o diagrama de bornes será feito
com os manuais das unidades entregues. Contatos existentes não devem compartilhar
tensões incompatíveis com o gateway; usar interface apropriada quando necessário.

O código inspecionado nesta revisão exige estas entregas antes da aceitação:

| Código | Consequência para a implantação |
|---|---|
| [normalizeTelemetry](../services/ingest/src/pipeline/normalize.ts) | Aceita contrato genérico e compacto de água, não o relatório agrupado do M100. Criar tradução, escalas, booleanos e vínculo por dispositivo |
| [MQTT](../services/ingest/src/mqtt.ts) e [autorização](../apps/api/src/modules/mqtt/routes.ts) | Se criar tópico de relatório, atualizar assinatura e autorização; protocolo MQTT compatível não significa integração pronta |
| [advanceUsage](../packages/shared/src/usage.ts) | Ignora leituras anteriores à última processada; reenvio precisa de ordem ou recomposição. Lacunas acima da política também não viram consumo conhecido automaticamente |
| [regras](../services/ingest/src/rules/evaluate.ts) | Leituras com mais de cinco minutos não geram incidentes de telemetria; separar recuperação de histórico de alerta atual |
| [contratos dos sensores](SENSORES.md) | Implementar também regras/telas para boias, falha de alimentação e divergência. Contato da bomba indica estado do contator, não prova vazão |

Não transformar falha Modbus, leitura inválida ou cabo desconectado em valor zero ou
“normal”. O heartbeat do gateway não comprova que cada sensor continua funcionando.

## 6. Condições de recebimento e aceitação

Comprar **um conjunto para o condomínio**, com preparação e ensaio antes da instalação.
A preparação não é um segundo piloto de bancada nem requer duplicar os equipamentos.

- Conferir nota fiscal, modelo completo, versão, garantia, prazo e itens inclusos;
  resolver as divergências dos anúncios e fichas destacadas nesta lista.
- Aprovar todos os pontos no painel e nas notificações. Central de incêndio,
  alarme local de gás e proteção da bomba continuam funcionando independentemente.
- Medir 60 min de autonomia com a carga real e testar retorno após esgotamento.
- Validar 4G, TLS, cartão ausente/cheio, relógio e reenvio. Meta proposta: 72 h de
  histórico na cadência definida, com equipamento alimentado, sem duplicar consumo.
- Conferir nível em três alturas, quatro boias, pulsos conhecidos e totalização
  após reinício. Simular contatos de alarme pelos procedimentos dos fabricantes.
- Operar por pelo menos 14 dias em campo e registrar perdas, reinícios, falsos
  alarmes e necessidade de intervenção antes de padronizar outras instalações.

**Não existe vencedor de confiabilidade comprovado por esta pesquisa.** Para gastar
menos com um resultado verificável, a recomendação é validar o M100-HM-GL com os
componentes especificados, resolver as pendências comerciais e reservar verba para
integração e instalação. Altus é alternativa se o piloto demonstrar uma necessidade
que justifique seu custo; não substitui a qualificação dos sensores e do conjunto.

## 7. Documentação técnica e referências comerciais

Os links das tabelas são referências de compra, não auditoria de fornecedores. As
condições contratuais e a unidade entregue devem corresponder aos manuais aplicáveis.

- [PUSR M100-HM][manual-m100] e [IO8000 e módulos de expansão][manual-io].
- [NOVUS DigiRail-4C][manual-counter], [comunicação][manual-counter-com] e [DigiRail IoT][manual-iot].
- [Megga MGG-TNH-SUB][manual-level], [WIKA LH-20][manual-wika] e [aplicação Eicos para caixa/cisterna][manual-float].
- [Dwyer WD3][manual-leak], [Innovar EL00][manual-el00] e [Segurimax 42961][manual-gas].
- [Mean Well MDR-60][manual-psu], [Finder série 40 e bases][manual-relay], [Schuhmacher Multiplast][manual-box].
- [CHINT série DTSU][manual-energy], [NOVUS RHT Modbus][manual-temp] e [Kingston High Endurance][manual-sd].
- [Altus Nexto Xpress][manual-altus] e [PUSR M300][manual-m300].

[g-gl]: https://gmbautomacao.com.br/produto/usr-m100-hmgl-rs485-232-ethernet-modbus-eth-tcp-mqtt-ssl/
[g-eth]: https://gmbautomacao.com.br/produto/usr-m100-hmeth-rs485-232-ethernet-modbus-eth-tcp-mqtt-ssl/
[g-io]: https://gmbautomacao.com.br/produto/modulo-de-i-o-8di-usr-io8000/
[g-m300]: https://gmbautomacao.com.br/produto/usr-m300-eth-rs485-232-ethernet-modbus-eth-tcp-mqtt-ssl/
[g-novus]: https://www.nobrebrasil.com/automacao-industrial
[g-altus]: https://melhorindustria.com.br/clp-1-eth-1-rs-485-1-can-16-ed-16-sd-5-ea-v/i-e-2-ea-rtd-66.016.101-9
[sd]: https://www.pichau.com.br/cartao-de-memoria-kingston-high-endurance-32gb-sdhc-v10-sdce-32gb
[counter]: https://www.equipabr.com/digirail-4c-rs485-novus/p
[counter-quote]: https://www.pidbrasil.com.br/condicionador-de-sinais-digirail-4c-4-entradas-digitais-contadoras-e-1-saida-rs485-modbus.html
[psu]: https://www.meanwellbrasil.com.br/fontes-acdc/fonte-para-montagem-em-trilho-din-24v-2-5a-60w
[ups]: https://loja.intelbras.com.br/nobreak-attiv-600va-220v/p
[level-shop]: https://www.acloncenter.com.br/medidores/nivel/sonda-de-nivel-hidrostatica-o28mm-com-cabo-de-5-metros
[energy]: https://www.cooperasolucoes.com.br/automacao-industrial/medidores-de-energia/medidor-inteligente-trifasico-dtsu666-3x220400v-5-80-a-4p-rs485-direta-chint-313280
[temp]: https://www.smartcomponentes.com/sensor-transmissor-de-temperatura-e-umidade-rs485-serial-modbus-rtu-xy-md02
[water]: https://www.hidrauconex.com/hidrometro-multijato-34-qmax-5m-h-com-saida-pulsada
[float]: https://www.flussen.com.br/sensores-de-nivel/montagem-lateral/la16m-40
[float-adapter]: https://www.flussen.com.br/adaptadores/adaptador-pvc-m16x25
[leak]: https://loja.mercatoautomacao.com.br/produtos/sensores/complementares-de-automacao/detector-de-vazamento-de-agua-para-superficie-com-saida-digital-e-buzzer/
[gas-shop]: https://vivercomseguranca.com.br/produto/detector-de-gases-segurimax-glp-e-gn-12-24v/
[box]: https://www.premiereletrica.com.br/quadro-multiplast-ip66-400x300x200mm-schuhmacher
[manual-m100]: https://www.pusr.com/uploads/20241205/285a4d714f715d1ad8a693f499136208.pdf
[manual-io]: https://www.pusr.com/uploads/20240611/566c67bb606301807c94c4f8bf37d32c.pdf
[manual-counter]: https://www.novus.com.br/downloads2/getFile.asp?Extensao=PDF&ID=1f39251ce7
[manual-counter-com]: https://cdn02.duxcloud.com.br/exsense/products/43/files/manual-de-comunicacao-L5p7c0Kz.pdf
[manual-iot]: https://cdn.novusautomation.com/downloads/manual_digirail_iot_v10x_en.pdf
[manual-level]: https://meggainstrumentos.com.br/wp-content/uploads/2023/07/MGG-TNH-SUB-2.pdf
[manual-wika]: https://www.wika.com/media/Data-sheets/Level/Submersible-pressure-sensors/ds_pe8156_archived_en_co.pdf
[manual-leak]: https://dwyer-inst.com/media/customuploads/files/WD3.pdf
[manual-el00]: https://innovarcontrols.com/wp-content/uploads/manuais/Sensor_Detector-de-Inundacao-Innovar-Controls-EL00.pdf
[manual-gas]: https://www.segurimax.com.br/media/catalog/product/attachments/FT_42961_-_Detector_de_G_s_GLP_GN_12V_24V_CONVENCIONAL.pdf
[manual-psu]: https://www.meanwell.com/Upload/PDF/MDR-60/MDR-60-SPEC.PDF
[manual-float]: https://icoscombr.s3.amazonaws.com/downloads/automacao-abastecimento-de-edificio-por-cisterna.pdf
[manual-relay]: https://cdn.findernet.com/app/uploads/S40EN.pdf
[manual-box]: https://www.schuhmacher.ind.br/produtos/linha/2/linha-multiplast?size_id=23&size_selected=1
[manual-energy]: https://www.chint.eu/es/material-electrico/control-y-gestion-de-la-energia/instrumentos-de-medida/serie-dtsu
[manual-temp]: https://novus.com.br/downloads/Arquivos/v10_a_manual_rht_modbus_%20portuguese.pdf
[manual-sd]: https://www.kingston.com/br/memory-cards/high-endurance-microsd-card
[manual-altus]: https://www.altus.com.br/wp-content/uploads/2024/10/Nexto-Xpress-pt-Rev-J.pdf
[manual-m300]: https://www.pusr.com/uploads/20231128/6111cca44fd425cb6664b0ff00339e12.pdf
