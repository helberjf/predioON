# Gestão transparente e chamados

Solicitação autorizada: completar funções existentes para moradores e síndicos, sem duplicar o monitoramento de consumo já implementado.

## Chamados

Reutilizar ocorrências e sua linha do tempo. Morador e síndico abrem chamados com gravidade baixa, média ou alta. Somente a administração altera gravidade, com motivo registrado no histórico; ambos podem comentar. Morador vê apenas seus chamados. Corrigir filtro de encerrados e preservar data de conclusão ao mudar outros campos.

Quando houver pelo menos três chamados abertos com categoria, assunto normalizado e local iguais, sugerir agrupamento à administração. Permitir também seleção manual de dois ou mais relatos do mesmo condomínio. Não concluir automaticamente: o síndico confirma o agrupamento e pode enviar status ou resposta comum ao grupo, mantendo protocolos e relatos individuais privados. Operações agrupadas são transacionais e auditadas.

## Transparência e contas

Criar página Transparência nos dois portais. Reutilizar avisos na categoria GESTAO para publicar decisões, serviços, prazos e esclarecimentos. O síndico escolhe o texto público; detalhes privados de chamados nunca são publicados automaticamente.

Adicionar prestação de contas mensal com saldo inicial, receitas, despesas, categorias, descrições e links HTTPS para comprovantes, resumo e saldo final calculados no servidor em centavos. Rascunhos só são vistos pela administração. Publicação explícita libera aos moradores do condomínio. Publicações são imutáveis; correções geram nova revisão do mês, preservando histórico. Não é conciliação bancária nem processamento de pagamentos. Arquivos permanecem no repositório documental escolhido pelo condomínio; a aplicação guarda links, sem baixar seu conteúdo.

## Consumo

Manter análise estatística existente de água e energia, com referência aprendida, alertas, tarifas e qualidade dos dados. Verificar testes e tornar o acesso claro a ambos os perfis. Não prometer diagnóstico automático da causa ou previsão financeira.

## Verificação

Testar HTTP e RLS com dois condomínios e moradores diferentes; gravidades inválidas; alteração de gravidade por morador; agrupamento e solução sem vazamento; rascunhos/publicação/revisões; valores exatos e URLs inválidas. Conferir os fluxos no navegador e executar regressão serial, tipos e build.
