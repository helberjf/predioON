# Transparência chamados e prestação de contas

Os portais do síndico e do morador incluem chamados e **Transparência e contas**. A consulta de **Consumo e análise** continua disponível aos dois perfis. Cada usuário vê apenas seu condomínio; nos chamados, moradores veem apenas os próprios relatos.

## Resumo para WhatsApp

1. Cadastrar síndico e moradores no condomínio correto.
2. Abrir chamados com local, descrição e gravidade baixa, média ou alta.
3. Síndico conferir prioridades, responder e justificar mudanças de gravidade.
4. Agrupar relatos do mesmo problema e informar uma solução comum.
5. Publicar andamento, decisões e prazos em Transparência e contas.
6. Cadastrar receitas, despesas e comprovantes; revisar e publicar as contas do mês.
7. Configurar medidores, tarifas e análise de água e energia; acompanhar alertas.

## Abrir e acompanhar chamados

Em **Chamados**, selecionar **Abrir novo chamado**. Morador e síndico informam categoria, resumo, local, unidade opcional, descrição e um dos três níveis:

| Nível | Uso sugerido |
|---|---|
| Baixa | Melhoria ou problema sem urgência |
| Média | Problema que afeta a rotina |
| Alta | Risco ou interrupção de serviço essencial |

O protocolo identifica o pedido. A fila coloca gravidades altas primeiro. **Ver histórico e responder** mostra abertura, respostas, mudanças de situação, agrupamento e alterações de gravidade. Para consultar encerrados, usar **Todos, incluindo encerrados**. A lista é paginada em grupos de 50.

O síndico pode mudar a gravidade, com motivo obrigatório, e o solicitante vê a justificativa e a classificação anterior. O morador pode comentar e cancelar um pedido ainda aberto; não pode reclassificar a gravidade nem substituir o encerramento de um chamado concluído. Concluir um chamado não contrata nem despacha um prestador automaticamente.

## Três chamados sobre o mesmo assunto

Quando houver três ou mais chamados abertos, ainda não agrupados, com categoria, resumo normalizado e local iguais, o painel sugere o agrupamento. A comparação ignora maiúsculas, acentos e pontuação; é uma sugestão de correspondência textual, não uma conclusão de que a causa é a mesma. A análise considera até os mil chamados abertos mais recentes.

1. Conferir se os relatos tratam realmente do mesmo problema.
2. Usar **Confirmar mesmo problema e agrupar**. Se a redação for diferente, selecionar manualmente de dois a cinquenta chamados abertos e escolher **Agrupar selecionados**.
3. Abrir o histórico de um chamado do grupo e marcar a opção para aplicar ao grupo.
4. Enviar uma resposta comum com providência, prazo e próximos passos. O texto é copiado ao histórico de todos os solicitantes do grupo.
5. Atualizar a situação ou a gravidade. As mudanças atingem o chamado selecionado e os demais ainda abertos; encerramentos anteriores são preservados.
6. Depois do reparo, registrar a solução e concluir o grupo.

Cada protocolo e relato original permanece preservado. O morador não recebe nome, unidade, descrição ou comentários particulares de outros moradores. Apenas a administração pode enviar uma resposta comum. O sistema não encerra pedidos automaticamente ao encontrar três semelhantes. Grupos existentes não são reagrupados nesta versão.

## Transparência da gestão

O síndico abre **Transparência e contas → Escrever atualização para os moradores**. O texto pode explicar serviços planejados, andamento de reparos, prazos, responsáveis, decisões e uso de recursos. **Publicar atualização da gestão** torna a mensagem visível na transparência e nos avisos do condomínio.

Chamados particulares não viram avisos automaticamente. A administração escolhe o conteúdo público. As atualizações usam a categoria **Transparência da gestão** do módulo de avisos, onde também podem ser editadas, agendadas ou retiradas conforme as permissões existentes. Essas mensagens podem ser corrigidas; a imutabilidade descrita abaixo se aplica às prestações de contas publicadas.

## Prestação de contas mensal

1. Em **Transparência e contas**, selecionar **Nova prestação**.
2. Informar mês, título, resumo da gestão e saldo inicial. Usar valores como `1234,56`, sem separador de milhares.
3. Adicionar receitas e despesas, cada uma com categoria, descrição, data dentro do mês e valor maior que zero. São aceitos até 500 lançamentos por relatório.
4. Quando houver comprovante, informar um link HTTPS sem credenciais embutidas. O arquivo fica no serviço escolhido pelo condomínio; conferir as permissões de leitura com um morador antes da publicação.
5. Selecionar **Salvar rascunho**. Só a administração visualiza os rascunhos.
6. Conferir lançamentos, receitas, despesas e saldo final. O cálculo é feito em centavos: saldo inicial + receitas − despesas.
7. Selecionar **Publicar para os moradores**. A publicação registra data e responsável e fica disponível ao condomínio.
8. Para corrigir uma publicação, escolher **Criar correção deste mês**, explicar a mudança, salvar e publicar a nova revisão. A versão anterior não é apagada nem modificada.

Para cada mês, a maior revisão publicada substitui as anteriores; um novo rascunho não altera o relatório vigente. Rascunhos antigos não podem ser publicados depois de uma revisão mais recente. Edições concorrentes são recusadas para evitar sobrescrita silenciosa. O saldo inicial é informado pela administração, sem transferência automática entre meses.

Este módulo registra e publica a prestação informada. Não faz conciliação bancária, cobrança, pagamento, cálculo de inadimplência nem autenticação dos comprovantes. O aplicativo não baixa os links nem concede permissões no serviço de arquivos.

## Análise de água e eletricidade

O módulo já implementado aprende uma referência estatística do histórico válido e alerta para desvios. É necessário associar o medidor acumulado de energia (`energy_total_kwh`) ou água (`water_total_m3`), ajustar tarifa, limites e habilitar a análise adaptativa. O painel informa aprendizado quando ainda não há dias suficientes, cobertura parcial e ausência de leitura atual.

A referência aprende mediana e variação de até 28 dias, com mínimo configurável de 7 a 28 dias válidos. Limites fixos podem alertar enquanto a referência ainda está aprendendo. A análise não identifica sozinha a origem de uma fuga elétrica ou vazamento. Procedimento completo em [Consumo e análise](CONSUMO_E_ANALISE.md).

## Instalação e validação

Aplicar `infrastructure/011-governance.sql` após as migrações anteriores, sem apagar o banco. Ela adiciona agrupamento, categoria de gestão e tabela de contas com RLS. Publicar a API e os dois portais na mesma atualização. `pnpm db:infra` inclui a migração automaticamente no ambiente local.

O síndico deve validar, com contas de teste, abertura dos três níveis, justificativa de reclassificação, agrupamento e resposta comum, privacidade entre moradores, rascunho invisível, publicação, comprovantes e nova revisão do mês. O suporte remoto usa o procedimento independente de [AnyDesk](SUPORTE_REMOTO.md).
