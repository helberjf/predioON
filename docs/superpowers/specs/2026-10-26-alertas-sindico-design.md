# Alertas compreensíveis para o síndico

Proposta aprovada pelo proprietário em 26/10/2026, com o complemento de manter informações técnicas em um menu expansível.

## Experiência

- Organizar os registros em “Precisam de atenção”, “Em acompanhamento” e “Resolvidos”, nessa ordem. Preservar todos os registros autorizados retornados pela API.
- Mostrar títulos em português: bomba ligada por mais tempo que o esperado, nível da caixa d’água baixo, alteração na energia, temperatura elevada e vazamento de água.
- Exibir a data do registro, situação e uma orientação curta. Priorizar gravidade dentro dos grupos pendentes. Alertas resolvidos representam histórico, sem afirmar que o equipamento está normal agora.
- Manter exemplos identificados como “Demonstração”. Não apresentar registros simulados como medições reais.
- Substituir “Reconhecer” por “Iniciar acompanhamento” e “Resolver” por “Marcar como resolvido”. Explicar que esses botões registram uma providência; não executam reparos nem acionam equipes.
- Cada registro terá um elemento HTML `details`, inicialmente fechado, com `summary` “Informações técnicas”. Mostrar mensagem original completa, tipo, gravidade, situação e identificadores originais de alerta, equipamento e central, além das datas de detecção e cadastro. Permitir abrir pelo teclado e quebrar identificadores longos no celular.
- Tipos personalizados mantêm sua mensagem original e título genérico, sem inventar interpretação. Situações desconhecidas permanecem visíveis entre os itens que precisam de atenção, com situação a confirmar.

## Limites e segurança

Alterar apenas a apresentação da página de alertas do portal do síndico. O administrador ou técnico que já tenha acesso à página poderá consultar os detalhes; nenhum papel ou permissão será concedido por esta mudança. Não consultar inventário para traduzir IDs: a leitura dos alertas e do inventário são permissões distintas.

Preservar endpoints, controle por recurso, atualização periódica, eventos, bloqueio de cliques simultâneos, recusa de ações sem permissão e remoção de seleção após revogação. Manter os estados de carregamento, erro e lista vazia sem anunciar normalidade do condomínio.

## Verificação

Verificar a página real isolada em Chromium com respostas fictícias para agrupamento, expansão técnica por teclado, preservação da mensagem original, resolução e acompanhamento, revogação, erro, vazio e largura de celular. Atualizar seletores das regressões existentes. Executar typecheck, build e fronteiras do projeto, sequencialmente para respeitar a memória disponível.
