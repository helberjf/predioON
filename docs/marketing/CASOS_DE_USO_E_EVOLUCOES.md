# Prédio ON — exemplos de uso e condições de instalação

Os cenários abaixo explicam o comportamento implementado no software. Os valores são ilustrativos; alertas reais dependem de medição, tarifa, parâmetros e equipamentos configurados no imóvel.

## Energia: de R$ 10 para R$ 50 por dia

O medidor envia um acumulador de kWh. A plataforma calcula a diferença entre leituras válidas, distribui o consumo pelo dia local do imóvel e multiplica pela tarifa configurada para mostrar **custo estimado**. Se a referência diária aprendida equivale a R$ 10 e o valor observado chega a R$ 50, o aumento é de 400%. Um limite diário configurado ou a análise histórica pode gerar alerta.

> Energia acima do padrão: custo estimado de R$ 50 hoje, diante de referência de R$ 10 por dia. Investigue a mudança no consumo.

O relato recebido sobre três contas de cerca de R$ 3.000 após uma fuga elétrica em luminária de jardim motivou esse caso. Ele não é um resultado comprovado do Prédio ON. O sistema pode antecipar a percepção do aumento; descobrir que a causa é uma luminária requer inspeção técnica. Os R$ 9.000 relatados não representam economia demonstrada.

## Água: consumo fora do habitual

O hidrômetro envia um acumulador em m³. A plataforma calcula consumo diário e pode comparar com limite e histórico. Isso é separado do volume da caixa d'água e do sinal direto de sensores de vazamento de água e esgoto.

> Consumo de água acima da referência. Confira o uso do imóvel e investigue possíveis vazamentos.

Consumo alto não comprova vazamento nem informa seu local. Medição ausente ou antiga é indicada como dado insuficiente.

## Bomba: de 1 hora para 2 horas no dia

O relé informa quando a bomba está ligada. O sistema soma períodos válidos e compara os minutos do dia com um limite ou referência histórica. Com limite de 60 minutos e operação observada de 120 minutos, o total dobra. É possível configurar também um limite para funcionamento contínuo.

> A bomba acumulou 120 minutos ligada hoje; o limite é 60 minutos. Verifique a operação.

Se houver falha prolongada na comunicação, a plataforma não presume que a bomba permaneceu ligada durante toda a lacuna.

## Vagas de carros e motos

O painel exibe capacidade, ocupação e vagas livres separadamente para carros e motos. A administração pode atualizar a contagem; sensores vinculados podem atualizá-la automaticamente. Origem e horário acompanham cada número. Se a leitura estiver antiga, a disponibilidade atual aparece como desconhecida, em vez de mostrar um zero enganoso.

## Avisos, serviços e acessos

Avisos de lixo, reuniões e limpeza podem ter data, publicação programada e repetição semanal. Reservas do salão e chamados continuam em fluxos próprios. Portões de garagem e pedestres podem receber solicitações remotas com autorização, prazo curto e confirmação pelo controlador. Abertura física só pode ser avaliada com controlador compatível instalado e testado.

## Transparência e atendimento

### Três relatos e um atendimento

Três moradores relatam a mesma falha na iluminação do jardim. O painel sugere o agrupamento quando categoria, assunto e local coincidem. O síndico confirma, registra a providência e envia uma resposta comum. Ao concluir o reparo, atualiza os chamados do grupo. Os moradores acompanham seus próprios protocolos, sem acesso aos relatos particulares dos vizinhos. Assuntos escritos de formas diferentes podem ser agrupados manualmente pela gestão.

### Contas e decisões visíveis aos moradores

O síndico publica o andamento do serviço na transparência e prepara as contas do mês com receitas, despesas e comprovantes por links. Os moradores veem apenas o relatório publicado. Uma correção gera nova revisão, mantendo a anterior consultável. Os valores são informados pela administração; não há conciliação bancária nem pagamentos automáticos. Veja o [guia de gestão](../GESTAO_TRANSPARENTE.md).

## Como funciona a referência de consumo

O modelo usa dias completos e válidos para calcular uma referência robusta de consumo e duração de bomba. Ele informa o valor esperado, a diferença observada e se há histórico suficiente. Regras de gás, fumaça, vazamento e tensão usam limites/sinais configurados. Essas análises não substituem diagnóstico técnico ou sistemas certificados de segurança.

Para detalhes, consulte [sensores](../SENSORES.md), [consumo](../CONSUMO_E_ANALISE.md), [vagas e avisos](../VAGAS_AVISOS.md), [acessos](../ACESSOS.md) e a [matriz de funcionalidades](../REVISAO_FUNCIONALIDADES.md). Disjuntores e extintores não fazem parte do escopo.
