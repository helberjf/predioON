# Candidato dos três DELETEs de vínculos

Estado: **AUTORADO, NÃO EXECUTADO**. Revisão independente solicitada. Não há typecheck, parser TypeScript, teste, PostgreSQL, RED/GREEN nem aceite de runtime deste delta. Nenhum Node, banco, navegador ou serviço foi iniciado pelo autor; fonte congelada, main, migrations, ACL e helpers compartilhados não foram editados.

Base examinada: `work/mfa-mandatory-browser-qa-20261107/source`, prepared `2abbf1a7fa9c7d54f6f0a6fc12938b3b14a27fa8da823590e8d9acb71a09087f`, 1.032 arquivos. Apenas `apps/api/src/modules/tenancy/routes.ts` aparece em before/after. O prefixo até a seção de revogação dinâmica é idêntico, inclusive seis PATCHs já aceitos, GETs, POSTs e convites. Não compor por sobrescrita se uma fonte futura tiver outra alteração nesse arquivo.

Escopo: DELETE `/v1/tenancy/{unit-memberships,team-members,role-bindings}/:id`. A configuração permanece fechada em três descritores do servidor. A resposta de sucesso continua204 vazia; todos os campos adicionais de decisão SQL são internos e não chegam ao HTTP.

## Desenho candidato

1. `lockRevocationTarget` coloca o guard em CTE MATERIALIZED, referenciado tanto pela busca com lock quanto pelo resultado escalar. Alvo ausente também exige uma decisão MFA. Não usa `readMfaRows` para lock/DML.
2. Mantém `FOR UPDATE OF target`, em vez de introduzir busca inicial sem lock. Isso preserva a aplicação das policies de UPDATE, incluindo delegação de papel, e a invisibilidade404 de quem só possui leitura. O binding global com `buildingId=null` continua404.
3. Uma decisão MFA em statement novo segue o lock, pois o snapshot do primeiro statement pode preceder uma espera. A capacidade explícita original é mantida depois desse ponto. Esse arranjo não afirma que o snapshot da primeira busca é renovado magicamente pelo lock.
4. No caso já inativo, uma segunda leitura guardada com FOR UPDATE usa o lock que a transação já detém. RLS de UPDATE, capacidade explícita e MFA pertencem a esse novo statement; a operação permanece204 sem auditoria/escrita. Não trocar esse ramo por uma simples verificação de leitura.
5. No caso ativo, registra auditoria antes de desativar, como o original. Um CTE de UPDATE depende do guard e conserva RLS/USING/WITH CHECK. O retorno escalar também depende do guard; exige exatamente o ID esperado. Zero linhas causa404 e rollback da auditoria, em vez de confirmar204 com um log sem revogação.
6. Uma checagem final MFA, após UPDATE e seus triggers, aborta mudanças de prova realizadas por triggers da própria transação. Não verifica capacidade de gestão novamente depois de autorrevogação legítima.

## Contratos preservados e limites

- Mantém o validador UUID e o404 de ID malformado anterior à transação; não o confunde com UUID válido ausente. Mantém o mapeamento PMF01/02 via inTenantContext, separado dos erros de constraint e RLS de inTenancy.
- Conserva ações, resourceType com hífen, ator, prédio e recurso da auditoria. updatedAt usa o mesmo relógio Date/milissegundos da API, transportado como ISO timestamptz; não muda para clock_timestamp.
- Não atualiza role, vigência, referências, grantedBy ou outros campos. Não adiciona sessão humana a workers nem acesso owner ao produto. Não cria retries automáticos.
- Controle de MFA não substitui capacidade/RLS e não amplia delegação. Os três alvos permanecem os mesmos; não inclui memberships legado, convites, suporte ou revogação global.
- A repetição de FOR UPDATE no ramo inativo adiciona uma consulta; não há medição de latência nem afirmação de otimização. O primeiro lock já foi adquirido, mas a validade exata do plano SQL e comportamento de RLS/CTE/espera precisam de PostgreSQL real.
- As decisões são por statement. Não há lock universal de usuário/fator/família, serialização global de alterações externas nem promessa de impedir qualquer mudança após o último snapshot e antes do commit/resposta. O efeito usa guard no mesmo statement; as checagens adicionais cobrem limites específicos, não substituem essa dependência.
- A nova recusa de UPDATE sem correspondência evita auditoria falsa. É uma mudança deliberada em uma corrida/negação tardia, não evidência de que esse caminho já foi reproduzido.

## Próxima prova, sob coordenação do root

O plano detalhado está em `work/mfa-next-revocation-static-20261107/PLAN.md`. Criar teste novo comum aos dois lados, congelar baseline/fixed separados, conferir tipos e executar apenas na fixture descartável oficial, serialmente e sob guards de memória. Exigir cerimônia HTTP MFA real na sessão do ator; permitir SQL owner somente para fixture/interleaving/inspeção.

Cobrir os três DELETEs: PMF01/PMF02 depois da capacidade real, ausência, idempotência, promoção pós-gate, perda de prova durante lock comprovado por pg_blocking_pids, RLS de escrita versus leitura, perda de gestão, ator global, autorrevogação direta/por equipe, triggers de auditoria/UPDATE e rollback. Confirmar estado e auditoria nos REDs esperados; erro genérico ou timeout não é uma prova de MFA.

Regressões propostas: tenancy-http, platform-mfa-tenancy-links, platform-mfa-tenancy-commands e tenancy-people, com código original e assertivas preservados. RBAC SQL requer revisão separada de fixtures. Nenhuma contagem de testes foi fixada ou executada por esta autoria.

Antes de publicar qualquer prova, verificar que o testador leu este limite: a fonte examinada contém frontend/QA do incremento de navegador, mas este delta afeta apenas API; não revalida os browsers, Android, iOS, matriz completa ou produção.
