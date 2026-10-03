# Auditoria por capacidades — migration 036

Estado em 03/10: recorte validado para publicação. A integral da API passou **658/658**, 51 suites, sem falhas/cancelamentos/skips, em 10min12s. Banco/restauração passou **26/26**, com 44 tabelas e 36 migrations recuperadas. Os cinco cenários web passaram **15/15** e a matriz integral passou **189/189** em Chromium, Firefox e WebKit, usando API, PostgreSQL e bundles compilados, sem retries. O lote dirigido atual passou 36/36, incluindo a mutação silenciosamente recusada. Este recorte integra a etapa 2B.3 e não encerra a migração dos demais domínios.

## Fronteira antes da implementação

`GET /audit` usa papel legado, memberships do token e SELECT de todas as colunas. A policy de leitura 001 aceita administração global como acesso a todos os eventos privados. `audit_logs.building_id` tem FK `ON DELETE SET NULL`: sua ausência não prova escopo global. A interface administrativa atual ainda confunde carregamento, erro e lista vazia e limita a consulta aos primeiros 100 registros.

## Autoridade e escopo persistido

- Adicionar `audit:read` ao catálogo local e ao papel BUILDING_ADMIN; não conceder a manutenção/morador/suporte por inferência. `audit:read-platform` pertence ao catálogo global de PLATFORM_ADMIN. Uma concessão global não concede leitura local.
- Persistir `scope_kind` como PLATFORM, BUILDING ou LEGACY_UNKNOWN e `scope_building_id` como texto sem FK. São derivados pelo banco na inserção e imutáveis depois dela; o SET NULL da FK de apresentação não recalcula nem apaga o tenant original.
- Classificar por ação, tipo de recurso e escopo real, nunca pelo ator nem por metadata fornecido. A coluna de categoria enviada por um cliente não é prova de classificação.
- Eventos locais usam concessões vigentes no tenant original, organização/condomínio/conta ativos e, quando pontuais, o recurso concreto ainda pertencente ao tenant. A concessão exata não permite ler eventos de seus vizinhos nem equivale à concessão inteira. Recursos removidos só mantêm histórico para quem tem `audit:read` amplo no condomínio; conjuntos sem um recurso RBAC concreto também exigem concessão ampla.
- Uma autoridade local ampla pode ler o histórico associado a seu condomínio, inclusive o provisionamento que o criou; uma autoridade global só pode ler eventos classificados PLATFORM. Não usar permissões operacionais de equipamentos/chamados para conceder leitura de auditoria automaticamente.
- Suporte mantém o catálogo diagnóstico atual, sem `audit:read` na allowlist de suporte. É possível conceder papel local explícito pelos mecanismos ordinários; isso não é uma concessão de suporte implícita.

## Matriz de classificação

| Ação e recurso | Evento novo | Histórico anterior à migration |
|---|---|---|
| ORGANIZATION_CREATED/UPDATED + organization | PLATFORM; sem tenant | PLATFORM somente para esse par e sem tenant; combinações incoerentes ficam desconhecidas |
| USER_CREATED + user | PLATFORM; sem tenant | Mesma regra, pois esse produtor é global e não recebe tenant |
| BUILDING_CREATED + building | PLATFORM, preservando o tenant criado e exigindo resourceId igual ao buildingId | PLATFORM somente com tenant/identidade comprovados; NULL anterior é ambíguo |
| BUILDING_UPDATED + building | BUILDING, independentemente do ator global ou local | BUILDING quando tenant presente; NULL anterior permanece desconhecido |
| FEATURE_CONFIGURATION_CHANGED + feature | BUILDING com tenant; PLATFORM sem tenant apenas para chave real de funcionalidade global e capacidade global vigente | Com tenant, BUILDING; sem tenant, LEGACY_UNKNOWN porque a FK pode ter sido removida |
| Demais eventos com tenant | BUILDING | BUILDING quando o tenant ainda está registrado |
| Demais eventos sem tenant, incluindo rejeições sem alvo comprovado | LEGACY_UNKNOWN | LEGACY_UNKNOWN, indisponível na projeção global até classificação administrativa explícita |

Não usar `metadata.buildingId`, nomes de usuário ou identidade do operador para recuperar automaticamente um tenant perdido. Logs desconhecidos continuam armazenados. A migration não apaga nem reescreve seus payloads.

## Leitura e escrita

- Substituir a policy SELECT e apenas o fallback genérico do CASE de INSERT. Preservar todas as branches específicas e o registro transacional dos domínios, incluindo as quatro branches físicas da034. A035 não introduz ação de auditoria.
- Acrescentar barreira restritiva de INSERT que prove os pares globais e a autoridade da ação: provisionamento para BUILDING_CREATED, features:manage para funcionalidade global, administração de plataforma vigente para os produtores de usuários/organizações ainda legados. Autorizar leitura nunca concede escrita. Um escritor local não pode criar um registro classificável como global por alterar action/resourceType.
- Não conceder UPDATE/DELETE. Proteger categoria e tenant original também durante alterações da FK. Reaplicação não reclassifica eventos já classificados, não reativa permissões/revogações nem substitui helpers/policies de outros domínios.
- Retornar DTO mínimo: ID, tenant original autorizado, ator, ação, tipo/ID do recurso, data e categoria. Não devolver IP, user-agent ou metadata bruto. Restringir SELECT do runtime às colunas da projeção; os campos sensíveis continuam disponíveis apenas ao proprietário administrativo e aos fluxos de inserção já autorizados. Um futuro detalhamento exige uma política de campos por ação, fora deste recorte.
- Preservar `/audit`, `{ items, limit, offset }` e filtro buildingId, agora aplicado ao tenant original. Ordenar por createdAt e id para paginação estável. Consultas sem qualquer concessão retornam 403, distinto de lista autorizada vazia; não revelar existência de tenant/recurso alheio.
- Consulta sem filtro pode reunir somente as linhas explicitamente autorizadas. O consumidor comum de auditoria usa a API como fonte de escopo, com carregamento, erro/retry, paginação, atualização e descarte de resposta ao trocar condomínio/conta. Administração e gestão recebem rotas próprias sem comparações ordinais de papel.

## Produtores que deixam o fallback genérico

| Ação / resource_type | Prova de escrita vigente |
|---|---|
| ORGANIZATION_CREATED/UPDATED / organization; USER_CREATED / user | Sem tenant, entidade real e flag `is_platform_admin` da conta ativa. Estes produtores permanecem legados até recorte próprio; não ampliar para papel global RBAC por inferência. |
| MEMBERSHIP_UPSERTED/REVOKED / membership | Membership real do tenant e `memberships:manage` local ou a administração global real já aceita pelo produtor legado. Isso não concede leitura local de auditoria. |
| BLOCK_CREATED / block; UNIT_CREATED / unit | `units:manage` inteiro e entidade real do mesmo tenant. |
| TEAM_CREATED / team; TEAM_MEMBER_ADDED / team_member; TEAM_MEMBER_REVOKED / team-members | `teams:manage` inteiro e entidade real do mesmo tenant. |
| UNIT_MEMBERSHIP_CREATED / unit_membership; UNIT_MEMBERSHIP_REVOKED / unit-memberships | `memberships:manage` inteiro e vínculo real do mesmo tenant. |
| ROLE_BINDING_CREATED / role_binding; ROLE_BINDING_REVOKED / role-bindings | `memberships:manage` inteiro e concessão real do tenant; criação também comprova `granted_by` igual ao ator. |
| SUPPORT_CONFIG_SAVED/REQUESTED/RESULT_RECORDED / remote_support | `app_support_admin()` atual, prédio ativo e host/request real; requested_by/closed_by correspondem ao ator nas respectivas ações. A restrição de leitura de suporte existente permanece. |
| Desconhecida ou par incoerente | Negada, inclusive com app.role forjado ou administração global real. |

`ACCESS_REQUEST_REJECTED` conserva sua policy estreita separada: USER atual, tenantNULL e recurso gate. Continua classificado como LEGACY_UNKNOWN, sem promoção a histórico global. Eventos físicos SYSTEM e abertura controlada pelo owner continuam fora da escrita livre do runtime. A substituição da expressão aborta diante de CASE aninhado inesperado, em vez de sobrescrever clauses de outro domínio.

Autorrevogação do membership legado exige registrar a auditoria antes de remover a própria autoridade, dentro da mesma transação. O draft HTTP faz essa mudança; um trigger de teste que recusa a mutação confirma rollback do registro anterior e preservação do vínculo.

## Testes e isolamento

- Banco exclusivo `predioon-test-audit`, loopback5435, baseline e migrations001–033 pelo runner controlado; nenhum dado compartilhado ou seed de demonstração necessário. RED usa arquivo `.pending.ts` invocado explicitamente para não contaminar a suite publicada.
- HTTP e SQL sem filtro: concessão direta/equipe/exata sem membership legado; síndico A/morador B; global não lê local; morador, suporte diagnóstico e contexto app.role forjado não leem auditoria.
- Revogação/expiração de binding e equipe, conta/papel/permissão/tenant/organização inativos, mantendo o mesmo token quando aplicável.
- Exclusão da FK não promove evento local a global; evento global que referencia prédio mantém sua classificação; gravar/alterar categoria ou tenant falsos falha; metadata/IP/user-agent nunca aparecem na resposta e SELECT direto desses campos é negado ao runtime.
- Exato sobre recurso estrangeiro, removido ou de outro tipo não funciona. Paginação com timestamps iguais não repete/omite registros. Estado vazio autorizado difere de erro/403.
- Reaplicar036 duas vezes em transação e comparar catálogo, ACLs, helpers, INSERT audit e policies alheias; fixtures próprias têm teardown em finally. Regressão de mutação+auditoria dos domínios permanece obrigatória.
- Medir EXPLAIN real com histórico local volumoso e poucos eventos globais. Se a consulta sem filtro varrer história privada, acrescentar pré-filtro autorizado e índice sem remover RLS ou perder a união de concessões globais/locais.
- Playwright real nos três motores: auditor global vê somente categoria autorizada, auditor local navega páginas e perde conteúdo após revogação, seleção de condomínio não conserva dados anteriores, erro seguido de retry.

## Aceite

- [x] RED documentado; desenho aprovado em princípio pelo agente principal, com exigências incorporadas na matriz de classificação.
- [x] Migration036 isolada e testes HTTP/RLS negativos verdes.
- [x] Consumidor web e Playwright dirigidos verdes.
- [x] Revisões de escopo e de ACLs/produtores, regressões completas e evidência exata antes da publicação.

## Evidência inicial

Banco5435 preparado pelo bootstrap e runner001–033, roles runtime separadas, sem seed. Os nove testes iniciais de audit-capabilities.pending.ts falharam nas lacunas esperadas: concessões RBAC sem membership bloqueadas, global lendo eventos locais/desconhecidos, filtro de tenant sem rejeição, payload bruto exposto e perda da FK promovendo histórico privado. O SQL com app.role forjado também retornou sete registros para um usuário sem concessão, confirmando que a antiga policy depende do contexto legado. Log preservado em .local/audit-capabilities-red.log. Tipos da API passaram. O arquivo pending só é invocado explicitamente até a implementação; nenhuma SQL036 ou alteração de produção foi aplicada nesta etapa.

O draft isolado passou depois em 21 casos próprios, incluindo INSERT desconhecido, par/recurso incorreto, rejeição sem tenant, autorrevogação e rollback. Somados a tenancy HTTP, membership lifecycle, suporte, governança e capacidades de edifício/funcionalidade, foram **68/68**, sem skip. O snapshot recebeu somente catálogo036, rotaaudit, ordem do registro na revogação e ajuste do teste de suporte para consultar ID em vez de SELECT*; a negativa de leitura dos campos privados foi acrescentada. O catálogo e runtime do checkout compartilhado continuam sem036. Reaplicação/ACL/performance, integração com034/035 e UI ainda estão pendentes.

## Integração e reaplicação — 02/10/2026

O snapshot isolado passou a incluir 034/035/036 e aprovou **98 testes**. A consulta global entre 30 mil eventos privados e 20 globais foi medida em 21 ms; a união de escopos globais/locais autorizados retornou 50 linhas em 87 ms. Foram preservados os produtores específicos de 034 e o fallback passou a reconhecer somente os pares de ação/recurso comprovados.

Um teste adicional reproduziu que reaplicar a migration recriava grants padrão removidos. A correção limita a inclusão dos papéis padrão às permissões realmente criadas na primeira instalação. Reaplicações não recriam grants, não reativam permissões e não recriam definições apagadas. O teste modifica esse catálogo em transação, reaplica duas vezes e reverte tudo; o conjunto dirigido passou **99/99**, sete suites, sem skips. Logs locais: work/audit036-reapply-red.log e work/audit036-reapply-green.log.

A primeira instalação também foi executada sobre banco publicado 035 em uma transação descartável: ambas as permissões e os dois grants padrão surgiram corretamente. O rollback restaurou 035, com ausência de scope_kind conferida. Esse ensaio não atualizou nenhum banco real.

O rascunho continua fora da runtime publicada e está preservado no patch de continuidade. Permanecem pendentes consumidor web, Playwright, revisão integral de ACLs/produtores, backup/restauração com 036 e regressão completa antes de publicar o domínio. Os resultados dirigidos não encerram esses itens.

## Implementação e verificações de03/10

`AuditPanel` é compartilhado entre administração e gestão do condomínio, com páginas de25 registros, ordenação do servidor, carregamento, erro/retry, vazio autorizado, atualização e descarte por conta/condomínio. O filtro e a autoridade vêm da API; o consumidor não usa comparações ordinais de papel. A rota do condomínio é `/auditoria` e aparece como Histórico de atividades na navegação.

O novo teste de revogação instalou um trigger exclusivo que retornaNULL sem alterar o vínculo. Antes da correção a rota respondeu204 e deixou auditoria de uma ação não realizada. Agora exige uma linha em `UPDATE ... RETURNING`; a ausência retorna409 e reverte tanto o registro como a mutação. O lote25 de auditoria mais tenancy/lifecycle passou36/36, sem skips. Logs: work/audit036-ignored-revoke-red.log e work/audit036-api-directed-final.log.

O backup customizado foi restaurado serialmente em outro banco criado pelo teste, com conferência de todas as tabelas, ledger, policies, owners, ACLs de tabela/coluna e definições dos helpers. A leitura local/global, revogação, campos privados, imutabilidade e exclusão da FK foram exercitadas no destino. Após corrigir duas fixtures incompatíveis com as restrições reais de papéis, a suite completa passou26/26, sem skips. Nenhuma restrição de produção foi flexibilizada. Log: work/audit036-db-verified.log.

Playwright passou15/15 nos bundles compilados: projeção mínima e privacidade global; paginação com timestamps iguais e viewport390px; concessão exata, revogação e vazio; falha/retry e troca de condomínio; logout/login de outra conta no mesmo documento com uma resposta antiga retida. O harness consome uma cópia da resposta real atrasada e comprova seu resourceId antes de conferir a ausência na tela. O cliente rejeita uma resposta de outra identidade antes de consumir JSON; aguardar o stream não utilizado com `Response.finished()` bloqueava o Chromium. Não foi acrescentado retry, espera arbitrária ou orçamento maior. Log: work/audit036-web-final.log.

As regressões finais usam bancos separados: API5444 com preparação e seed equivalentes ao CI, navegador5443 e banco/restauração5442. A primeira integral da API foi interrompida porque seu banco sem seed não continha bld_001 nem a conta demonstrativa exigida por testes existentes; não conta como execução aprovada. A fonte congelada contém16 arquivos do recorte, com todos os SHA-256 conferidos contra o volume Linux. Manifesto local: work/audit036-final-source.json. As oito imagens anteriores já foram publicadas emccda38c; capturas positivas deste consumidor serão acrescentadas depois da publicação.

A matriz completa posterior passou **189/189**, sem retries, em26 minutos; log work/audit036-web-full.log. A integral da API5444 terminou **642/645**, com duas falhas de import por ausência de dependências da ingestão e uma interrupção do stream após seu prazo de45 segundos, durante a execução simultânea do navegador. Uma cópia nova foi criada com dependências completas, `pnpm install --frozen-lockfile --offline`, fonte conferida por16 hashes e banco novo5445 com seed. A nova integral executa sem disputa com Playwright. Nenhum prazo ou assert foi alterado; o resultado anterior continua registrado como falha, sem determinar sozinho a causa da interrupção do stream.

## Aceite deste recorte

A nova integral5445 terminou **658/658**, 51 suites, sem falhas, cancelamentos ou skips, em10min12s. Os módulos de lifecycle/monitoramento carregaram as dependências fixadas e o percurso de equipamento/funcionalidades cumpriu seu prazo original, incluindo a fase de ANY misto em28,3s. Log: work/audit036-api-complete-full.log. O resultado é uma execução integral própria; não soma os642 anteriores aos dirigidos.

A revisão de escopo conferiu classificação por ação/recurso, tenant imutável, grants locais/global/exatos e ausência dos campos privados na projeção. A revisão de escrita/ACL conferiu preservação das branches034, fallback finito, prova global restritiva, owners/search_path, execução privada dos helpers e ausência de UPDATE/DELETE. Reaplicação, primeira instalação, rollback, revogação e restore real foram exercitados, além da regressão completa. O manifesto work/audit036-complete-dependencies-source.json teve os16 hashes conferidos depois da instalação congelada das dependências. Tipos dos13 workspaces, limites de pacotes e83 testes UI também passaram. As revisões foram realizadas pelo agente principal; não se afirma aprovação por revisores independentes.

Permanecem fora deste recorte exportação por cursor, detalhamento com política de campos por ação, os administrativos ainda legados, identidade037, processamento durável, novos módulos, homologação nativa e vídeos finais. As capturas positivas do consumidor acompanham a documentação de imagens com seu commit de origem.
