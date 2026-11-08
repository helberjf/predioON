# Teste comum dos três comandos de revogação

**Autorado e revisado estaticamente pelo root e pelo revisor independente, sem bloqueador identificado e sem execução.** O arquivo é novo e deve ser idêntico no baseline e no fixed; não importa helpers novos do candidato. Não houve Node, tipos, PostgreSQL, teste, navegador, serviço ou alteração de main/fonte congelada nesta autoria.

Fonte examinada: `work/mfa-global-binding-browser-qa-20261107/source`, prepared `36e5b4a28d0c9b24d2b7420b9401366dad4d1842c7597238a84e283c958c902e`, 1.033 arquivos. A rota tenancy dessa fonte é igual à base2abb usada pelo candidato; o produto proposto é `work/mfa-tenancy-revocation-candidate-20261107`, before4089…/after37754…. Esta pasta contém o teste diretamente em `apps/api/test/platform-mfa-tenancy-revocations.test.ts`, sem subdiretório after.

## Seleção finita

São **21 testes independentes**, uma suite describe e zero grupos agregadores/subtestes. Para cada uma das três rotas há seis testes: perda do fator, perda da prova, UUID válido ausente, no-op inativo, controle de gestor opcional e controle de administrador satisfeito. Há três controles adicionais: autorrevogação direta, autorrevogação da participação na equipe que dá gestão e escopo/leitor/global/UUID malformado.

Previsão estática, ainda não resultado: baseline9PASS/12FAIL, fixed21PASS. Dos doze negativos, seis mutações e três no-ops devem mostrar204 em vez de403; três ausentes devem mostrar404 em vez de403. Cada erro esperado precisa ser observado e revisado no log real. Uma falha de setup, HTTP429/500, deadline, SQL ou tipos não satisfaz esse RED.

## MFA real e interleavings

Cada teste negativo cria um ator distinto com flag administrativa e gestão local explícita. O mesmo bearer/SID faz login, enrollment e confirmação TOTP reais via HTTP. O teste verifica dez códigos únicos, fator confirmado e geração da prova correspondente, depois `/auth/me=satisfied`. Não insere fator criptografado falso nem escreve aprovação na sessão.

Somente depois da barreira real o owner da fixture remove o fator ou limpa os dois campos de prova, simulando uma mudança concorrente comprometida. Não há restauração sintética; o ator não volta a ser usado como aprovado. A limpeza remove a conta e seus dados temporários. Os controles opcionais fazem login real sem obrigação MFA.

O proxy de teste executa a SQL original antes de observar o resultado. A barreira de capacidade reconhece especificamente o SELECT separado que começa com `select app_has_capability(`, verifica allowed=true e os parâmetros exatos de capacidade/prédio. Não confunde a substring presente no CTE novo com `assertCapability`. O caso ausente usa o lock compartilhado de funcionalidades já existente, dentro do contexto autenticado e antes do SELECT sem alvo.

Os negativos com alvo têm controle positivo anterior; a fixture restaura apenas active/updatedAt e auditoria desse vínculo, não a identidade/fator/prova. Quando o baseline retorna204, o teste compara resposta vazia, linha persistida completa (exceto o timestamp gerado que deve avançar) e a auditoria exata antes de falhar na asserção403. No no-op compara inclusive updatedAt intacto e nenhuma auditoria. No ausente compara o mesmo corpo404, ausência de linha e ausência de auditoria.

## Contratos e limpeza

- Confere204 vazio, Cache-Control no-store, campos não alterados, ação/resourceType/ator/prédio/recurso e uma auditoria. Repetição autorizada não muda linha ou auditoria.
- Exercita autorrevogação direta e por equipe sem obrigar gestão depois do efeito. A chamada seguinte fica sem acesso e não cria auditoria adicional.
- O controle de leitor cobre **somente unit-memberships**: usa seu bearer/SID real em uma consulta runtime sob RLS para provar que vê a própria linha; DELETE deve preservar a invisibilidade404 causada pela policy de UPDATE. Não é prova dos leitores das três tabelas. Não há SID inventado nem conexão owner na operação HTTP.
- Confere tenant estrangeiro, binding global com buildingId nulo e IDs malformados. Esses controles não atribuem ao endpoint uma revogação administrativa global.
- Verifica ledger68 e identidade real da role predioon_app. Listener em127.0.0.1, HTTP/barreiras/encerramento limitados a5s; transações de restauração/cleanup usam lock_timeout2s e statement_timeout3s. O proxy é sempre liberado/restaurado e transações são aguardadas antes de remover fixtures. `helpers.ts` preserva o encerramento final dos pools identity/broker.
- Sem retry de login, alteração do orçamento compartilhado, relaxamento de autorização, segredo nos diagnósticos ou alteração dos testes existentes. Os atores únicos usam três admissões por conta administrativa; a rodada deve ocorrer em fixture UUID oficial fresca, serialmente.

## Limites explícitos

Este lote **não** ensaia espera real por row lock, promoção pós-gate, perda de capacidade durante espera, triggers de auditoria/UPDATE ou corrida de UPDATEzero. Esses cenários continuam no plano amplo `work/mfa-next-revocation-static-20261107/PLAN.md`; a revisão estática do produto não substitui seus ensaios. Não confundir a barreira após capacidade com prova de bloqueio em pg_blocking_pids. Escopo estrangeiro cobre as três rotas; o controle SELECT permitido versus DELETE oculto cobre apenas unit-memberships.

Não cobre todas as combinações de papéis, suporte, janelas de vigência, todos os tenants ou bootstrap. Não revalida browsers/apps, screenshots, Android/iOS, performance, matriz completa ou produção. A aceitação futura deve citar exatamente estes21 casos e as regressões que o root realmente executar, sem somar resultados históricos como se fossem uma nova rodada.
