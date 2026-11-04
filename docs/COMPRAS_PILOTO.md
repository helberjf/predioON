# Lista de compras do piloto de monitoramento

Revisão de **04/11/2026** para **instalação em um condomínio**. Escopo: somente
monitoramento. Os dados do local ficam **para preencher**, conforme solicitado.
Esta lista atualiza os preços e o dimensionamento do [estudo de hardware](ESTUDO_HARDWARE.md).

**Escolha recomendada:** PUSR **USR-M100-HM-GL**, expansão **IO8000**, armazenamento
local, contagem dedicada de água, fonte de procedência, nobreak e sensores cabeados.
O 4G integrado acrescenta R$ 681,03 sobre o HM-ETH e merece prioridade para manter
alertas quando a internet do condomínio falhar. Essa escolha é uma avaliação de
custo e recursos; depende da aprovação da troca de conexão, do histórico e da integração.

**Revisão econômica de água e vazamentos:** substituir a referência DigiRail-4C por
**Teracom TDI340**, os dois Dwyer por **RISCO RK6F cabeados + fonte de 12 V**, e o kit
de hidrômetro de R$ 398 por **Renova UR equipado, ref. 5132250000068**, se o local
atender às condições abaixo. A redução de referência é **R$ 1.003,43**; não é garantia
de menor preço de todo o mercado nem de igual durabilidade entre os fabricantes.

**Referência de materiais: R$ 9.744,01–10.934,01**, no cenário da seção 4.
Não é orçamento instalado: inclui anúncios condicionais, disponibilidade a confirmar,
o valor inicial de sondas ainda não configuradas e verbas estimadas de infraestrutura.
Instalação, integração, manutenção e adequações do local precisam entrar no fechamento.

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
| Água | **Para preencher**: diâmetro, vazões mínima/normal/máxima, pressão, temperatura, posição, comprimento disponível, hidrômetro existente e litros por pulso |
| Gás | **Para preencher**: GLP/GN, ambiente, pontos de risco e quantidade/posição de detectores |
| Vazamentos | **Para preencher**: localização dos dois pontos, líquido, sujeira, duração/profundidade possível de alagamento, tempo máximo para detectar e área efetivamente coberta |
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
| Contador **Teracom TDI340**, novo, quatro entradas | 1 | 1.080,91 | 1.080,91 | A — [catálogo LRI][tdi-shop]; Pix 1.048,48. O link individual redireciona ao catálogo e a página técnica pede cotação: **confirmar disponibilidade, preço e firmware**; não tratar como entrega imediata |
| Fonte **Mean Well MDR-60-24**, 24 V, 2,5 A | 1 | 205,66 | 205,66 | A — [Mean Well by LRI][psu]; à vista 199,49. Não substituir por anúncio “tipo Mean Well” |
| Fonte dos detectores **Mean Well HDR-15-12**, 12 V, 1,25 A, LPS | 1 | 107,25 | 107,25 | A — [Mean Well by LRI][psu12]; à vista 104,03. Página específica informa **45 dias úteis**; confirmar prazo. Alimentar pelo nobreak, ajustar para 12 V e proteger os ramais |
| Nobreak **Intelbras ATTIV 600 VA, 220 V, 4822201** | 1 | 480,88 | 480,88 | A — [loja oficial][ups]. **Referência 220 V**; tensão definitiva para preencher, autonomia a medir |
| Nível **Megga MGG-TNH-SUB**, 4–20 mA, dois fios | 2 | C — a partir de 880,00 | **Fora deste subtotal** | [Aclon][level-shop]. Há versões “sem cabo”: cotar faixa, cabo ventilado completo e materiais para a água do local |
| Energia **CHINT DTSU666, 313280**, direto 80 A | 1 | 618,50 | 618,50 | A — [Coopera][energy]; à vista 575,21. **Referência 3×220/400 V**; não liberar para rede/corrente ainda desconhecidas |
| Temperatura **XY-MD02**, RS485, unidade OEM | 1 | 115,90 | 115,90 | A — [Smart Componentes][temp]; Pix 104,31. Opção econômica somente para ambiente interno compatível, após conferência da versão e leitura |
| Hidrômetro **Renova UR unijato equipado**, ref. **5132250000068**, DN20 × 115 mm | 1 | 168,90 | 168,90 | A — [loja do fabricante][water-ur]; Pix 163,83. Inclui sensor; anúncio: Q3 4 m³/h, Q4 5 m³/h, R80-H, 1 L/pulso. **Referência condicional**: conferir dimensão, modelo elétrico do emissor, unidade nova e documentação metrológica |
| Boias **Eicos LA16M-40** | 4 | 51,00 | 204,00 | A — [Flussen][float]. Duas por reservatório, uma alta e uma baixa; confirmar montagem, material e vedação |
| Adaptadores **PVC M16×25** das boias | 4 | 5,00 | 20,00 | A — [Flussen][float-adapter]. Trocar por fixação apropriada se o reservatório exigir |
| Vazamento **RISCO RK6F / RK6F0000000**, cabeado | 2 | 318,00 | 636,00 | A — [JBP][risco-shop], **por encomenda**. Um para água e outro para derramamento de esgoto aquoso. IP67, contato NF; **não ligar em 24 V**. Aplicação e limpeza conforme seção 3 |
| Gás **Segurimax 42961**, convencional 12/24 V, relé | 1 | 290,00 | 290,00 | A — [Viver com Segurança][gas-shop], por encomenda. Cadastro da loja diverge na marca: confirmar Segurimax e código 42961 na proposta |
| Quadro **Schuhmacher Multiplast 210640**, 400×300×200 | 1 | 219,66 | 219,66 | A — [Premier Elétrica][box]; Pix 208,68. Preço exibido na consulta indexada; confirmar no orçamento. Verificar espaço e dissipação antes de fechar |
| **Subtotal das referências acima, sem as duas sondas** | | | **6.664,01** | Redução de **1.003,43** frente aos 7.667,44 anteriores, sob as condições das substituições; não representa carrinho pronto |

O subtotal sem o TDI340, cuja disponibilidade precisa de confirmação, é **R$ 5.583,10**.
Os demais anúncios também dependem de tensão, dimensionamento, aplicação e prazo.
As condições dos outros itens foram preservadas da revisão desta mesma data.
Não foram efetuadas compras nem contatos com fornecedores.

### Materiais de instalação ainda a dimensionar

As verbas **P** abaixo são estimativas de planejamento, não preços pesquisados de um
kit pronto. Quantidades finais, códigos e comprimentos serão fechados pelo instalador.
O quadro, as fontes e o nobreak já constam da tabela anterior e não são somados novamente.

| Material | Quantidade prevista | Modelo ou especificação a fechar | Verba total P |
|---|---|---|---:|
| Montagem interna e distribuição 24/12 V | 1 conjunto | Trilho DIN 35, canaleta, bornes identificados, fusíveis por circuito, terminais e prensa-cabos; ramais dos dois detectores separados | 250–400 |
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
isoladas entre si. Com quatro boias, são dez estados digitais das funções do piloto,
mais os dois diagnósticos de 12 V da proposta RISCO; acrescentar o pulso deixa a
expansão ainda mais relevante. Não aprovar a troca apenas pelo preço.

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

### Vazamento: RISCO cabeado como opção econômica condicionada ao local

O **[RISCO RK6F][risco-product]** tem fabricante identificado, manual e contato de
alarme, por **R$ 318 por ponto**. Dois sensores e a fonte adicional de 12 V custam
**R$ 743,25**, contra R$ 1.454,26 dos dois Dwyer: economia de **R$ 711,01**. Não usar
as características da versão sem fio que aparece na mesma página da família.

O [manual RISCO 5IN1478 D][manual-risco] especifica 12 V típicos, faixa 5–16 VDC,
5 mA máximos e contato **NF limitado a 16 VDC/50 mA**. A alimentação de 24 V do restante
do quadro **não serve ao sensor nem ao contato**. A [HDR-15-12][manual-psu12] fornece
12 V/1,25 A e é LPS, conforme a exigência do manual. Alimentá-la pelo nobreak.
Usar os contatos secos nas entradas 2 e 3 do TDI340, cujo circuito é de baixa tensão
e corrente máxima de 3 mA; não aplicar 12/24 V nessas entradas.

**Limites que decidem a substituição:** IP67, 0–60 °C, cabo original de 1,5 m e
detecção após **pelo menos 10 segundos contínuos molhado**, com retorno aproximadamente
2 segundos após secar. Serve como candidato para líquido aquoso no piso, com montagem
horizontal e limpeza acessível. **Não equivale ao IP68 do Dwyer**, nem é a escolha
automática para submersão prolongada, poço de esgoto, líquido agressivo ou ambiente
que exija proteção específica. Para esgoto, validar compatibilidade, sujeira,
incrustação e recuperação após limpeza. Se esses requisitos não forem atendidos,
manter a alternativa adequada e refazer o preço; não registrar a economia como obtida.

O contato abre com alagamento, mas um rompimento do fio de sinal também pode abri-lo.
Tratar o evento como **“vazamento ou falha do circuito”**, com inspeção, sem afirmar
que o contato identifica a causa. O manual não comprova alarme em toda perda de
alimentação. Prever duas DI do IO8000 para presença de 12 V **após a proteção de cada
ramal**, dentro do quadro, e invalidar a leitura de seco se essa alimentação falhar.
Isso supervisiona fonte/fusíveis, **não comprova alimentação na ponta nem detecta todo
curto ou sensor travado**. Testar as falhas de campo e acrescentar supervisão apropriada
se o risco local exigir. O fabricante exige teste **ao menos semanal**; incluir visita,
limpeza e teste na operação, pois custo de manutenção também conta.

| Alternativa para dois pontos independentes | Custo de referência | Decisão |
|---|---:|---|
| **RISCO RK6F + HDR-15-12** | **743,25** | Menor conjunto documentado encontrado e selecionado, condicionado aos limites acima; sensores por encomenda e fonte com prazo a confirmar |
| [Dwyer WD3-LP-D2][leak] | 1.454,26 | Manter se a aplicação precisar de sua proteção IP68; confirmar código sem A e condições de imersão com o fabricante |
| [CAREL FLOE000010 + FLOS000000][carel-shop], dois conjuntos | A partir de 1.152,00 **+ transformador** | Controlador 406 + sonda 170 por ponto, por encomenda; [manual][manual-carel] exige **24 VAC**, não a fonte 24 VDC existente. Supervisão de cabo documentada, mas não é a alternativa mais barata |
| [Innovar EL00][manual-el00] / Teracom TSF400 | Cotação | Sem preço público verificável para um conjunto equivalente; não lançar economia presumida |
| [Placa genérica de chuva com relé][leak-generic] | 39,17 por placa | Excluída: placa exposta sem comprovação equivalente de proteção, aplicação e manutenção. O preço não representa sensor pronto para o condomínio |

No Dwyer, o [manual][manual-leak] distingue o **WD3-LP-D2 sem sirene, IP68**, do
**WD3-LP-D2-A com sirene**, vedado somente até três quartos da altura. O anúncio
menciona buzzer apesar do código sem A: resolver a divergência na proposta.

### Gás

O [Segurimax 42961][manual-gas] fornece relé NA e alarme local, mas é **IP20**. Não serve
automaticamente a áreas molhadas, externas ou que exijam detector específico para
atmosfera explosiva. Definir local e gás, prazo de substituição e procedimento de teste
do fabricante. Publicar `gas_detected`; não inventar `gas_ppm`. O alarme local permanece
independente da internet. Um contato NA simples não denuncia sozinho cabo rompido.

### Água: medidor equipado e contador com memória documentada

**Menor referência nova encontrada com emissor incluído para Q3 = 4 m³/h:**
[Renova UR DN20 × 115 mm, ref. 5132250000068][water-ur], **R$ 168,90**. O anúncio
informa 1 L/pulso, R80 na horizontal, pressão de 10 bar, água até 30 °C e IP68.
Confirmar **o código do emissor, contato seco compatível com o TDI340 e duração dos
pulsos**: a página do kit não fornece todos os limites elétricos. Não substituir
por versão somente “pré-equipada”, sem sensor incluído.

**DN20 ainda é uma referência, não o dimensionamento aprovado do condomínio.**
Q3 = 4 m³/h é a vazão permanente; Q4 = 5 m³/h é sobrecarga, não capacidade contínua.
A vazão mínima Q1 anunciada é 50 L/h: não prometer medição precisa de pequenos
vazamentos abaixo disso. Vazão de início de movimento não equivale à precisão
garantida. Preencher vazões, diâmetro, posição, pressão, temperatura e espaço antes
de comprar; se não atender, cotar outra dimensão/classe e substituir o valor.

O [manual residencial do fabricante][manual-water] orienta posição, sentido de fluxo
e proteção da instalação, mas não substitui a ficha da variante fornecida. Exigir
unidade nova, garantia, identificação do modelo, aprovação de modelo aplicável e
verificação metrológica inicial vinculada à unidade. **A menção comercial à Portaria
155/22, isoladamente, não comprova aprovação do modelo exato**; essa documentação
ainda está pendente. Ver [avaliação de modelo][inmetro-modelo] e
[verificação][inmetro-verificacao] do Inmetro.

| Opção de hidrômetro/emissor | Quantidade e preço normal | Quando escolher |
|---|---:|---|
| **Renova UR equipado, DN20 × 115 mm** | **1 × 168,90** | Base econômica, se todas as condições acima forem atendidas; Pix 163,83 |
| [Renova MR4 multijato equipado, DN20 × 190 mm][water-mr] | 1 × 193,90 | Alternativa por **mais 25,00**, se o corpo de 190 mm couber. Kit anuncia medidor + Reed V4 Colibri PA; não concluir maior confiabilidade apenas por ser multijato. Pix 188,08 |
| [Kit multijato da referência anterior][water] | 1 × 398,00 | Manter/cotar se sua versão atender melhor ao local; não há razão documental para pagar o adicional apenas pelo anúncio |
| [Reed Switch V4 Colibri][water-reed], ref. 6140000000000 | 1 × 81,00 | Menor compra se **já existir hidrômetro Colibri pré-equipado compatível e aprovado**. Economia adicional de 87,90 frente à base; não presumida. Pix 78,57 |
| Hidrômetro existente com saída compatível já instalada | Sem novo medidor | Maior economia possível, após verificar condição, resolução, titularidade e autorização de uso da saída |

Não alterar lacres ou instalar acessório no equipamento da concessionária sem
autorização aplicável. Conexões, cavalete e adaptação hidráulica ficam para cotar.

**Contador escolhido: [Teracom TDI340][tdi-product], R$ 1.080,91.** O
[manual R1.11, para firmware V1.06 ou posterior][manual-tdi] documenta quatro canais,
Modbus RTU, contagem de 32 bits e memória não volátil. É uma vantagem documental
frente à referência DigiRail-4C anterior; não prova menor taxa de falhas em campo.
A economia do contador é **R$ 63,32**. Confirmar firmware e fornecimento na proposta.

A alimentação do TDI340 admite 5–28 VDC e pode usar a fonte de 24 V. **Suas entradas
admitem no máximo 5,5 V**, com até 3 mA: não são DI de 24 V. O isolamento funcional
de 1 kV separa o grupo de entradas da alimentação/serial; não é isolamento individual
de cada entrada, que compartilha SGND. Reservar canal 1 aos pulsos e canais 2/3 aos
contatos RISCO, deixando canal 4 livre.

Para reed, ajustar filtro e borda a partir dos pulsos reais, evitando duplicação por
rebote. O modo polling tem período de 10 ms e atrasos configuráveis; o modo edge
admite até 100 Hz, **sem esses filtros**. Contar uma única borda por pulso. O manual
informa retomada do último valor armazenado, mas não quantifica a janela de gravação:
medir a eventual perda ao cortar a alimentação. **Depois que o nobreak esgota, pulsos
podem ser perdidos mesmo com memória**; confrontar o total mecânico e dimensionar
autonomia ou acumulador autônomo se a continuidade absoluta for necessária.

Foram encontrados contadores COEL HWKTS com RS485 por [R$ 461,50][coel-low] e
[R$ 698,90][coel-code]. O anúncio mais barato diverge entre título e especificação
de tensão, e não foi obtido manual aplicável comprovando retenção e mapa da versão
exata. O segundo identifica **HWKTS-NHLRRBXVJ--P----**, mas também exige essa validação.
**Não entram no total como substitutos aprovados**; além da contagem, seria necessário
repor as duas entradas de baixa tensão que o TDI340 oferece aos detectores. Contar
pulsos por consulta periódica a um módulo de estados também não é equivalente.

### Energia, temperatura e alimentação

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
  interface de diagnóstico separada na provisão. A **HDR-15-12 adicional** alimenta
  somente os detectores de 12 V; manter as duas fontes e seus ramais identificados.
- **Nobreak:** sustentar fonte, módulos, sensores e os equipamentos de rede necessários,
  inclusive ONT e switch quando utilizados. Medir autonomia e retomada com carga real.
  Não concluir autonomia a partir de “600 VA”. O medidor de energia deve medir o
  circuito previsto, e não somente a saída estabilizada do nobreak.

## 4. Custo total e economias que preservam funções

O fechamento correto, com 4G, é:

> **Materiais = R$ 5.583,10 + TDI340 recotado + duas sondas completas cotadas
> + infraestrutura cotada + diferenças das versões necessárias ao condomínio.**

Como cenário, usando o contador a R$ 1.080,91, duas sondas a R$ 880 e as provisões
de R$ 1.320–2.510, obtém-se **R$ 9.744,01–10.934,01**. O preço inicial das sondas
**não comprova fornecimento com cabo**. Confirmar estoque do contador e prazos dos
sensores/fonte; essa faixa é planejamento, não teto de implantação.
Com HM-ETH, o mesmo cenário cai para **R$ 9.062,98–10.252,98**, com a diferença de
continuidade de comunicação explicada acima.

| Substituição nesta revisão | Referência anterior | Referência nova | Redução |
|---|---:|---:|---:|
| Dois detectores de vazamento, incluindo agora a fonte de 12 V | 1.454,26 | 743,25 | 711,01 |
| Contador de pulsos; [referência anterior esgotada][counter] | 1.144,23 | 1.080,91 | 63,32 |
| Hidrômetro equipado | 398,00 | 168,90 | 229,10 |
| **Grupo revisado** | **2.996,49** | **1.993,06** | **1.003,43 (33,5%)** |

Esta é uma redução de materiais sob condições, sem assumir economia de frete,
adaptação hidráulica ou manutenção. Se for necessário conservar o hidrômetro de
R$ 398, a redução das demais trocas será **R$ 774,33**. Se o local exigir outro
detector, retirar também a economia correspondente e recalcular a alimentação.

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
3. **Reutilizar saída de água existente antes de comprar medidor novo**. O Reed V4
   de R$ 81 só serve ao hidrômetro Colibri pré-equipado compatível; não é universal.
   Com medidor novo, o Renova + TDI340 soma **R$ 1.249,81**, antes da instalação.
   Comparar Modbus nativo com total persistente e mesma capacidade, incluindo a
   reposição das entradas dos dois RISCO antes de eliminar o TDI340.
4. **Usar RISCO nos pontos que cumpram seus limites** e confirmar os preços completos.
   Reaproveitar fonte de 12 V somente se LPS, capacidade, condição e alimentação pelo
   nobreak forem comprovadas; não retirar a fonte da conta por suposição.
5. **Evitar CLP mais caro sem benefício necessário**. Gastar em proteção, alimentação,
   instalação e diagnóstico resolve riscos que a marca do controlador não elimina.

## 5. Entradas e integração com o código

| Recurso | Uso lógico proposto |
|---|---|
| Duas AI do M100 | Nível da caixa e da cisterna |
| Oito das dez DI do M100 + IO8000 | Bomba, gás, alarme de incêndio, quatro boias e falta de rede |
| Duas DI restantes, alocadas fisicamente no IO8000 | Presença de 12 V após a proteção de cada ramal RISCO no quadro; entrada aceita 9–36 V em nível alto, conforme manual |
| TDI340, canal 1 | Contagem dedicada do hidrômetro, sem contar pulsos por leitura periódica do gateway |
| TDI340, canais 2 e 3 | Estados dos contatos secos NF dos RISCO de água e esgoto; não aplicar tensão externa |
| TDI340, canal 4 | Reserva para contato seco/diagnóstico de baixa tensão compatível; expansão adicional se faltarem canais |
| RS485 | Contador, energia e temperatura, com endereços únicos e parâmetros compatíveis |

**As dez DI principais ficam ocupadas**, incluindo os dois diagnósticos de 12 V;
resta um canal do TDI340. A numeração é lógica; o diagrama de bornes será feito
com os manuais das unidades entregues. Contatos existentes não devem compartilhar
tensões incompatíveis com o gateway; usar interface apropriada quando necessário.

Mapa inicial do [TDI340 R1.11][manual-tdi], a conferir no firmware fornecido:

| Dado | Leitura Modbus FC03 | Interpretação |
|---|---|---|
| Contador do canal 1 | PDU 210, endereço lógico 40211, **uint32 em dois registros de 16 bits** | Ordem de palavras configurável em PDU 13; padrão MSW primeiro. Ler o total completo, não somente 16 bits |
| Contato do canal 2 | PDU 202, lógico 40203 | 0 fechado; 1 aberto |
| Contato do canal 3 | PDU 203, lógico 40204 | 0 fechado; 1 aberto |

Converter pulsos para `water_total_m3` usando litros/pulso e uma referência inicial
conferida com o mostrador; persistir os ajustes de troca/reinício do contador. Preferir
o contador bruto de 32 bits à conversão float32 para evitar perda de resolução em
totais grandes. Não zerar o contador na coleta nem escrever seu registro de 16 bits.
Tratar retorno a zero e transbordamento de 32 bits de forma distinta e testada.

Os estados alimentam `water_leak_detected` e `sewage_leak_detected` com regras/telas
que explicitem **alarme de vazamento ou circuito aberto**. Alimentação ausente,
timeout ou falha identificada devem gerar qualidade/diagnóstico de falha, nunca
“seco confirmado”. Essa tradução e a supervisão adicional ainda precisam ser entregues.

O código inspecionado nesta revisão exige estas entregas antes da aceitação:

| Código | Consequência para a implantação |
|---|---|
| [normalizeTelemetry](../services/ingest/src/pipeline/normalize.ts) | Aceita contrato genérico e compacto de água, não o relatório agrupado do M100. Criar tradução, escalas, booleanos e vínculo por dispositivo |
| [MQTT](../services/ingest/src/mqtt.ts) e [autorização](../apps/api/src/modules/mqtt/routes.ts) | Se criar tópico de relatório, atualizar assinatura e autorização; protocolo MQTT compatível não significa integração pronta |
| [advanceUsage](../packages/shared/src/usage.ts) | Ignora leituras anteriores à última processada; reenvio precisa de ordem ou recomposição. Trata queda do acumulado como reinício; não reconstrói sozinho transbordamento do contador. Lacunas acima da política também não viram consumo conhecido automaticamente |
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
- Conferir nível em três alturas e quatro boias. Para água, conferir mostrador,
  litros/pulso, vazão, posição e documentação da unidade; testar pulsos conhecidos,
  rebote, reinício, corte abrupto e totalização sem duplicação.
- Molhar cada RISCO conforme manual e medir detecção e retorno. Testar falta de 12 V,
  fusível aberto, ruptura de sinal/alimentação e curto de sinal, registrando quais
  falhas são ou não identificadas; não aprovar risco residual incompatível com o local.
  Confirmar limpeza do ponto de esgoto e programar o teste semanal do fabricante.
- Simular os demais contatos de alarme pelos procedimentos dos fabricantes.
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
- [Teracom TDI340, manual R1.11][manual-tdi] e [especificação do fabricante][tdi-product].
- [RISCO RK6F, manual 5IN1478 D][manual-risco], emitido pelo fabricante e hospedado no suporte Golmar, e [família Flood Detector][risco-product].
- [Renova, instalação residencial][manual-water], [aprovação de modelo][inmetro-modelo] e [verificação metrológica][inmetro-verificacao].
- [NOVUS DigiRail-4C][manual-counter], [comunicação][manual-counter-com] e [DigiRail IoT][manual-iot].
- [Megga MGG-TNH-SUB][manual-level], [WIKA LH-20][manual-wika] e [aplicação Eicos para caixa/cisterna][manual-float].
- [Dwyer WD3][manual-leak], [Innovar EL00][manual-el00] e [Segurimax 42961][manual-gas].
- [Mean Well MDR-60][manual-psu] e [HDR-15][manual-psu12], [Finder série 40 e bases][manual-relay], [Schuhmacher Multiplast][manual-box].
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
[tdi-shop]: https://www.lri.com.br/modulos-de-aquisicao-de-dados/teracom
[tdi-product]: https://www.teracomsystems.com/sensors/s0-pulse-counter-modbus-rtu-tdi340/
[manual-tdi]: https://www.teracomsystems.com/download/s0-pulse-counter-with-modbus-rtu-interface-tdi340-user-manual/
[coel-low]: https://www.proesi.com.br/temporizador-e-contador-hwkts-nfc-100-240vca-vcc-entrada-npn-pnp-coel
[coel-code]: https://loja.edgeautomacao.com/contador-digital-coel-hwkts-nfc-100-a-240vcavcc-rs485
[psu]: https://www.meanwellbrasil.com.br/fontes-acdc/fonte-para-montagem-em-trilho-din-24v-2-5a-60w
[psu12]: https://www.meanwellbrasil.com.br/fontes-acdc/fonte-para-montagem-em-trilho-din-12v-1-25a-15w-fina-em-formato-degrau-1su
[manual-psu12]: https://www.meanwell.com/Upload/PDF/HDR-15/HDR-15-SPEC.PDF
[ups]: https://loja.intelbras.com.br/nobreak-attiv-600va-220v/p
[level-shop]: https://www.acloncenter.com.br/medidores/nivel/sonda-de-nivel-hidrostatica-o28mm-com-cabo-de-5-metros
[energy]: https://www.cooperasolucoes.com.br/automacao-industrial/medidores-de-energia/medidor-inteligente-trifasico-dtsu666-3x220400v-5-80-a-4p-rs485-direta-chint-313280
[temp]: https://www.smartcomponentes.com/sensor-transmissor-de-temperatura-e-umidade-rs485-serial-modbus-rtu-xy-md02
[water]: https://www.hidrauconex.com/hidrometro-multijato-34-qmax-5m-h-com-saida-pulsada
[water-ur]: https://www.renovamedicao.com.br/hidrometroresidencial/hidrometro-unijato-4m-dn20x115mm-equipado-com-sensor-nova-portaria-inmetro
[water-mr]: https://www.renovamedicao.com.br/hidrometroresidencial/hidrometro-multijato5m-dn20x190mm-equipado
[water-reed]: https://www.renovamedicao.com.br/acessorios/sensores/sensor-reed-switch-v4-colibri
[manual-water]: https://empresa.renovamedicao.com.br/wp-content/uploads/2024/04/Manual-de-instalacao-hidrometro-Residencial.pdf
[inmetro-modelo]: https://www.gov.br/inmetro/pt-br/assuntos/metrologia-legal/controle-legal-de-instrumentos-de-medicao/modalidades/avaliacao-de-modelo
[inmetro-verificacao]: https://www.gov.br/inmetro/pt-br/assuntos/metrologia-legal/controle-legal-de-instrumentos-de-medicao/modalidades/verificacao
[float]: https://www.flussen.com.br/sensores-de-nivel/montagem-lateral/la16m-40
[float-adapter]: https://www.flussen.com.br/adaptadores/adaptador-pvc-m16x25
[leak]: https://loja.mercatoautomacao.com.br/produtos/sensores/complementares-de-automacao/detector-de-vazamento-de-agua-para-superficie-com-saida-digital-e-buzzer/
[risco-shop]: https://jbpdistribuidora.com.br/produto/detector-de-inundacao-com-fio/
[risco-product]: https://riscogroup.com/en/rscm_product/flood-detector/
[manual-risco]: https://d7rh5s3nxmpy4.cloudfront.net/CMP5021/files/5IN1478-D-Wired-Flood-Detector-Instructions-ML-WEB_%281%29.pdf
[carel-shop]: https://www.capitalrefrigeracao.com.br/detector-de-alagamento
[manual-carel]: https://www.carelbefeuchtung.com/documents/10191/0/%2B050004116/c2866783-f6a2-4ce5-a7bc-62aaa6c94529?version=1.3
[leak-generic]: https://www.baudaeletronica.com.br/produto/sensor-de-chuva-com-rele-12v.html
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
