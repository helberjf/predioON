# Ações web no recurso autorizado

## Problema e recorte

Os portais já recebem listas filtradas pela API, mas ações de alerta e gestão de chamados dependem de capacidades inteiras passadas pelo App. Uma concessão válida para um único recurso fica sem controles. O formulário de novo chamado e o cancelamento também aparecem sem distinguir criação autorizada e autoria real.

- Alertas: consultar somente a seleção atual; combinar as capacidades do próprio alerta e de seus deviceId/gatewayId reais, sem consultar inventário. Reconhecer e resolver exigem leitura e sua capacidade específica. O gateway do dispositivo não concede direitos se gatewayId não estiver registrado também no alerta, conforme SQL021. Reconsultar após ação, foco e atualização manual/periódica; revogação confirmada remove os controles.
- Chamados: criação exige occurrences:create-own e occurrences:read-own no condomínio inteiro. O detalhe expandido consulta o recurso occurrence. Gestão individual exige occurrences:manage; comentário/cancelamento próprio exigem leitura própria e openedBy igual ao usuário atual. Revogação fecha o detalhe e descarta seu rascunho.
- Manter validação final no servidor, isolamento de respostas ao trocar seleção/condomínio/conta e módulos pausados.
- Ações coletivas continuam disponíveis somente com autoridade inteira comprovada. Uma concessão sobre um chamado não prova permissão sobre os demais membros do grupo, que podem estar ocultos. Um futuro DTO canManageGroup calculado pelo servidor pode liberar conjuntos exatos completos sem revelar seus IDs; esse trabalho fica fora deste incremento.

## Evidência prevista

- [x] Matriz publicada ce18474: 35 cenários/105 execuções nos três navegadores contra SQL até 032, com correção dirigida descrita abaixo.
- [x] RED real: alerta exato; leitura no equipamento + resolução no gateway; chamado gerenciado exato em grupo com vizinho oculto; leitura própria sem criação.
- [x] Implementação, testes puros de composição de autorização e regressões contra respostas antigas.
- [x] GREEN dos novos cenários em Chromium, Firefox e WebKit; typechecks/builds e revisão independente.

Fixtures SQL criam papéis, vínculos, gateway e alertas exclusivos (não há endpoint público para emitir alertas). Prédio, pessoas, dispositivo e chamados são criados pela API real. O helper local limita cada pool a uma conexão; o teardown em finally remove somente os registros do próprio cenário, incluindo auditoria do prédio, prédio, pessoas e papéis. O tráfego do navegador usa API real e credenciais restritas. A matriz publicada roda de git archive em volume isolado para excluir drafts posteriores de API e migrações.

## Evidência executada

- Snapshot completo ce18474 + SQL até 032: 102 passaram e três falharam, em 37,4 minutos, sem retries ou skips. As três falhas eram o mesmo teste de logout esperando /auth/logout, endpoint que os portais substituíram por /auth/web/logout. Os traces mostram a tela de login já exibida.
- Correção apenas de e2e/platform.spec.ts para usar o helper signOut: 3/3 passaram, em 2,1 minutos, nos três motores e mantendo a mesma versão do produto/API 032. O resultado é composto (102 originais + três corrigidos), não uma segunda execução integral de 105.
- Relatórios preservados em .local/playwright-report-ce18474-linux e .local/playwright-report-ce18474-logout-recheck, com logs e traces correspondentes. Os artefatos locais são ignorados pelo Git.
- Para o RED conjunto de ações, estacionamento e sessões, o volume recebeu apenas API/packages compartilhados/SQL 033 do commit ff3e528; as telas permaneceram em ce18474. Essa combinação reproduz a interface anterior com os contratos atuais, sem drafts externos. Dos 11 cenários Chromium, dez falharam como esperado e a compatibilidade de leitura de vagas do morador passou. Os quatro cenários deste recorte falharam pela ausência das ações de alerta ou pela presença indevida do formulário de criação de chamado. Artefatos em .local/playwright-report-ui-three-scopes-red, resultados e log correspondentes.
- A primeira rodada com a implementação deste recorte, mantendo API/SQL 033, executou os quatro cenários novos e dois de serviços do morador nos três motores: 12 passaram e seis falharam somente porque a asserção buscava ACKNOWLEDGED/RESOLVED na tela, que traduz os estados para Em atendimento/Resolvido. A resposta real da mutação era 200. Os testes agora verificam separadamente o enum do JSON e o texto da interface; a repetição dirigida passou 6/6 em 50,5 segundos, sem retries ou skips. Resultado composto: 12 passes iniciais + seis repetidos após corrigir exclusivamente a asserção, com a mesma implementação. Artefatos em .local/playwright-report-resource-actions-green-initial e .local/playwright-report-resource-alerts-recheck, resultados e logs correspondentes.
- Testes puros da UI: 69/69, incluindo cinco novos casos de escopo, pais reais, autoria e revogação. Typechecks da UI e dos três portais, tipos E2E, três builds Vite e limites entre pacotes passaram. Root revisou a implementação; backend revisou contratos e fixtures, sem bloqueadores restantes.

## Compatibilidade de gravidade legada

Após o checkpoint de ações por recurso, um cenário real reproduziu em Chromium a exigência indevida de justificativa ao abrir um chamado cuja prioridade persistida era URGENT. A interface já apresentava esse valor como HIGH/Alta, mas comparava o formulário com a grafia original. A comparação agora usa o mesmo significado nos dois lados: salvar somente o andamento não envia priority nem priorityReason, preserva URGENT no banco e não cria evento de reclassificação.

O teste e2e/occurrence-priority.spec.ts também altera explicitamente para LOW, comprova a exigência de motivo na UI e o HTTP400 da API quando ausente, e verifica persistência e histórico depois do reload. RED Chromium registrado; GREEN 3/3 nos três motores, 40,3 segundos, sem retries ou skips, mantendo API/SQL 033. Relatórios em .local/playwright-report-occurrence-priority-red e .local/playwright-report-occurrence-priority-green. Typechecks da UI, gestão e morador passaram; suíte pura da UI atualizada passou 73/73. Nenhuma migração ou alteração de contrato foi necessária.
