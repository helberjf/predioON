# MFA obrigatória da administração — plano de implementação

Estado: desenho, sem alteração de autenticação, migration ou testes no repositório. Nenhuma DB foi iniciada para este recorte. Base de produto consultada: c619844; documentação posterior preservada. A obrigatoriedade já foi decidida pelo proprietário; não há nova decisão de produto a pedir para implementar esse escopo. RF-07 mais amplo, sobre ações privilegiadas do síndico, continua parcial fora deste primeiro recorte.

**PLANEJADO — NÃO IMPLEMENTADO — REDs NÃO EXECUTADOS.** A revisão/congelação abaixo é técnica e interna; não constitui pedido de nova autorização ao proprietário.

## 1. Resultado esperado

Quem possuir autoridade efetiva de administração da plataforma deve cadastrar MFA no primeiro acesso e provar o fator na sessão que pretende operar. Senha correta sem fator cadastrado cria somente uma sessão restrita de configuração. Essa sessão não lê domínios, faz ações administrativas nem recebe SSE. Confirmar o cadastro em uma sessão não libera outras sessões antigas.

Uma conta que vire administradora durante uma sessão já aberta passa pelo mesmo gate na próxima requisição, renovação e entrega SSE. Uma conta sem autoridade administrativa conserva a MFA opcional existente. Conta/role/binding inativo, futuro ou expirado não é tratado como administração vigente. Não inferir obrigação pelo endereço do portal ou por `Identity.role`, que hoje deriva do flag legado.

## 2. Evidência da fonte lida

- `apps/api/src/auth/service.ts`: `effectiveRole()` usa o flag legado; `resolveIdentity()` confirma família ativa e chama `buildIdentity()`. Login só pede código quando `mfaEnabled()` já é verdadeiro; refresh conserva a família e não recebe código.
- `infrastructure/021-authorization-time-windows.sql`: `app_rbac_platform_role_at(user, role, instante)` considera catálogo ativo, conta ativa, flag administrativo e binding global válido. É a autoridade a reutilizar, sem reimplementar o RBAC em TypeScript.
- `apps/api/src/auth/mfa-factor.ts`: TOTP/recovery são consumidos por UPDATE condicional, uma vez. O código consumido pode continuar gasto mesmo se a sessão posterior não for criada; esse comportamento documentado deve ser preservado.
- `apps/api/src/auth/mfa.ts`: cadastro pendente, confirmação e disable já existem; a confirmação atual não vincula a prova à sessão; disable não tem obrigação administrativa.
- `infrastructure/055-session-recent-verification.sql`: `sessions.verified_at` recebe `now()` por default, inclusive login só com senha. Não é prova de MFA.
- `apps/api/src/auth/verification.ts`: confirmação recente tem janela de dez minutos, password+MFA quando habilitada, só para a sessão atual. Refresh não atualiza o relógio.
- `apps/api/src/app.ts`: `/auth` e `/events` precedem o authenticate dos domínios. O gate apenas no middleware comum seria incompleto.
- `apps/api/src/modules/events/routes.ts`: autentica diretamente, revalida antes de cada entrega e em heartbeat. Os três pontos precisam da mesma obrigação.
- `packages/ui/src/components/mfa-panel.tsx`: painel existente pode ser reutilizado, mas deve conservar a tela única dos recovery codes antes de liberar a navegação.
- Os três `apps/*-web/src/App.tsx` montam providers de domínios após reconhecer `user`; o gate deve vir antes deles. `packages/mobile/src/app.tsx` precisa impedir a montagem operacional de sessão restrita, mesmo sem cadastro nativo neste recorte.

## 3. Estado persistido e migration aditiva 068

Proposta de arquivo novo: `infrastructure/068-platform-mfa-required.sql`. Não alterar 046, 055 ou outra migration publicada.

1. Acrescentar `mfa_factors.generation uuid NOT NULL DEFAULT gen_random_uuid()`. A identidade da geração muda quando uma inscrição pendente é substituída ou o fator é removido e recriado. Não é segredo e não sai no DTO.
2. Acrescentar `sessions.mfa_verified_at timestamptz NULL` e `sessions.mfa_factor_generation uuid NULL`. Sem default e sem backfill de prova: todas as famílias antigas começam sem comprovação. Um CHECK mantém ambas nulas ou ambas preenchidas. Não copiar `verified_at`/`created_at`.
3. Acrescentar helper booleano estreito `identity_platform_mfa_required(target_user_id text)`, SECURITY DEFINER, dono de autorização controlado, search_path fixo `pg_catalog, public, pg_temp`, referências qualificadas. Ele chama a autoridade da 021 para `PLATFORM_ADMIN` com instante atual. Não retorna bindings, papéis ou dados de terceiros.
4. Revogar EXECUTE de PUBLIC e de todas as seis roles; conceder apenas `predioon_identity`. Não conceder SELECT de bindings, helpers genéricos de RBAC ou escrita em sessões ao app. Testar catálogo/dono/search_path/ACL/negativas. A role identity já administra fatores/sessões; manter o alcance existente, sem dar poder às outras cinco roles.
5. Atualizar o schema Drizzle das duas colunas de sessão. Fatores hoje usam SQL direto: tipar a geração explicitamente no resultado, sem criar novas portas administrativas.

A geração evita que uma sessão aprovada por um fator antigo seja liberada por um fator recém-cadastrado. Comparar somente `confirmed_at != null` ou um booleano de conta é insuficiente. Não fazer FK que apague evidência histórica automaticamente; a validade vem da igualdade com a geração atualmente confirmada.

## 4. Resolução da sessão e contrato

Adicionar a `AuthUser` um estado explícito obrigatório, por exemplo `mfaRequirement: 'not-required' | 'enrollment-required' | 'verification-required' | 'satisfied'`.

| Autoridade atual | Fator atual | Prova desta família para a mesma geração | Estado |
| --- | --- | --- | --- |
| Não administrativa | qualquer | qualquer | not-required |
| Administrativa | ausente ou pendente | qualquer | enrollment-required |
| Administrativa | confirmado | ausente/geração diferente | verification-required |
| Administrativa | confirmado | presente e geração igual | satisfied |

`login`, login web, refresh, refresh web e `/auth/me` devem serializar a mesma avaliação do banco. O JWT continua identificando sub/sid; não embutir um `mfa=true` que sobreviva à revogação/promoção. Não mudar o significado legado de `role` neste recorte.

Para a sessão restrita, `/me` devolve apenas a identidade necessária ao cadastro (id/nome/e-mail/estado); não antecipar descoberta ou dados dos condomínios. Manter contratos coerentes, por exemplo memberships vazio enquanto restrita. Retornar `Cache-Control: no-store`.

O erro de operação protegida é `403` com motivo específico `MFA_ENROLLMENT_REQUIRED` ou `MFA_VERIFICATION_REQUIRED`. Não usar `401` (que dispara refresh no cliente) nem `VERIFICATION_REQUIRED` (que tenta repetir a ação sensível após confirmação recente). Erros de senha inválida continuam genéricos, sem revelar MFA/autoridade antes da validação da senha.

## 5. Prova por sessão e transações

**Login com fator confirmado:** consumir TOTP/recovery uma vez e obter a geração efetivamente consumida. Dentro da transação existente de criação da família, depois do lock da conta e da reconferência do hash da senha, revalidar que o fator confirmado continua com essa geração. Só então escrever a prova nessa família. Se o fator mudou ou foi removido, não emitir prova para o novo fator. O código já consumido permanece gasto caso a criação posterior falhe, preservando o contrato atual. Revalidar também se o fator foi habilitado durante o login que inicialmente não o exigia; não converter essa corrida em sessão operacional sem prova.

**Login administrativo sem fator:** criar família sem prova e emitir estado de cadastro obrigatório. Não há acesso de domínio nessa família. Falta de chave MFA no ambiente não pode produzir fallback operacional: status disponível falso e cadastro/prova falham fechados; informar indisponibilidade, preservar logout.

**Confirmação do cadastro:** manter os dez recovery codes exibidos uma única vez. Dentro de uma transação, seguir ordem de lock consistente (conta -> família -> fator), confirmar somente a geração/ciphertext que foi lida e validada, gravar códigos e marcar prova somente na família atual ainda ativa. Qualquer negativa/rollback não retorna códigos nem libera família. Uma inscrição pendente substituída concorrente não pode ser confirmada por código do segredo antigo.

**Sessão antiga com fator já confirmado:** reutilizar `POST /auth/verify` para password+código, preservando o budget existente. Após consumo válido, comparar geração atual e marcar prova apenas nessa família. Confirmar em outra aba com família distinta não libera esta. Não criar endpoint de bypass ou aceitar código sem sessão/senha conforme o contrato atual.

**Relógio 055:** login password+MFA pode usar seu `verified_at` original; `/auth/verify` válido atualiza verified_at e prova da sessão. Confirmar somente o código de inscrição não estende automaticamente a prova de senha: manter o verified_at existente e exigir confirmação recente novamente se a janela de dez minutos já venceu. Refresh nunca renova verified_at ou mfa_verified_at.

**Disable:** se a autoridade administrativa estiver vigente, negar antes de apagar fator/códigos, inclusive sessão com MFA comprovada. A checagem deve ser atual e próxima da escrita, sob a mesma ordem de locks da operação. Se não houver autoridade administrativa, preservar password+código e comportamento opcional. Remover/recriar fator invalida a prova das famílias antigas por diferença de geração; não reaproveitar comprovação anterior.

**Consumo concorrente:** alterar o retorno interno do consumo para prova de geração, preservando o UPDATE condicional. Incluir geração nos predicados; para recovery, garantir que o código pertence à mesma geração confirmada observada (lock transacional do fator ou vínculo equivalente). Não alterar janela TOTP, tolerância, número de códigos, budgets ou prazos. Falhas do driver não podem expor DSN, segredo/ciphertext ou códigos.

## 6. Gate HTTP e SSE, sem rotas acidentalmente abertas

Preferir autenticação normal que exige sessão operacional por default. Separar autenticação de sessão válida para as poucas rotas de bootstrap MFA, declaradas explicitamente; não implementar uma comparação de strings ampla por prefixo em todo o middleware.

Permitidas enquanto restrita: leitura mínima de `/auth/me` e `/auth/mfa`, enroll/confirm do próprio usuário, `/auth/verify` para fator já confirmado, logout web/nativo e revogação das próprias famílias. Revisar se listagem de sessões é estritamente necessária; não liberar metadados adicionais por conveniência. Não liberar mudança de senha, convites, autorização, features, descoberta ou outras rotas de domínio pelo simples fato de estarem sob `/auth`.

Os endpoints públicos de recuperação continuam com semântica atual e respostas sem enumeração. Redefinir senha não remove MFA nem fabrica prova; as famílias seguem revogadas conforme o fluxo existente.

SSE deve negar antes de writeHead quando restrita, e revalidar a obrigação antes de cada projeção/entrega e no heartbeat já existente. Promoção durante stream aberto encerra-o sem entregar conteúdo posterior. Não aumentar intervalos/prazos para passar testes.

Revalidar em pontos de autorização relevantes depois de locks controlados, preservando a política atual de capacidades. **Não basta o instante de authenticate:** uma conta pode ganhar autoridade enquanto a requisição espera e usá-la em assertGlobalCapability/inTenantContext sem prova. O lote dirigido deve colocar barreira determinística entre esses pontos, promover a conta em conexão independente e verificar403 e ausência de efeito de domínio.

Proposta de ponto de observação para esse caso: em `inTenantContext`, reavaliar autoridade/prova após os locks já previstos e antes do callback protegido; reavaliar novamente depois do callback, ainda dentro da transação e antes de devolver o resultado/commit, para que a negativa reverta suas escritas. Inventariar as rotas que chamam `withUserContext` diretamente e aplicar a mesma fronteira nessas operações antes de alegar cobertura delas. Não confiar somente no estado req.auth capturado antes da barreira. Operações que produzam efeito externo antes do fim da transação exigem análise explícita; não introduzir retry/compensação automática para escondê-lo.

O teste também deve posicionar uma barreira após a primeira revalidação e antes da ação para provar o rollback no ponto final. O caso pode falhar por evidenciar fronteira diferente da proposta: conservar esse RED e ajustar o recorte, sem dizer que toda corrida foi resolvida. O ponto final é uma observação de autoridade, não um lock global contra todas as alterações RBAC; uma concessão posterior a ele continua sujeita à próxima observação. **Não anunciar segurança linearizável global.**

Esta proposta é um gate de autenticação HTTP/SSE por sessão; não declara que chamadas SQL arbitrárias com a role app passam a verificar MFA. Não ampliar RLS, helpers gerais de capacidades, fila ou suporte para resolver essa primeira entrega. A prova deve cobrir os pontos HTTP/SSE explicitamente observados e as corridas de fator/família, com seus limites registrados.

## 7. Consumidores web e mobile

Reutilizar um gate compartilhado antes de OrganizationAccessProvider, BuildingScopeProvider e FeatureProvider nos três portais. Não montar leitores de domínio/SSE enquanto estado restrito. Gate apresenta cadastro obrigatório ou password+código para a família atual, botão de sair e indisponibilidade clara quando a chave não está configurada. Não ocultar somente o menu.

Estender MfaPanel para modo obrigatório, sem botão disable; depois de confirmar, manter recovery codes até a pessoa indicar que os guardou. Só então reconsultar `/me` e trocar o gate. Não colocar códigos/segredos em storage, URLs, logs, mensagens entre abas ou screenshots publicados. A reconsulta não pode transformar outra família em satisfeita.

No cliente, tratar o novo motivo403 como mudança de estado de sessão: invalidar/suspender leitores privados e trazer `/me`, sem refresh em loop e sem repetir automaticamente a escrita que falhou. Preservar generations, descarte de respostas antigas e coordenação entre abas. Promoção em sessão já aberta deve desmontar o domínio quando detectada, e respostas tardias anteriores não podem repovoar os dados privados.

Apps Morador/Operação: estado restrito não entra no fluxo operacional nem inicia chamadas/SSE. Mostrar orientação para concluir MFA no portal configurado e opção de sair; não inventar cadastro nativo ou abrir URL arbitrária. Reavaliar `/me` ao retornar. Um novo login com TOTP/recovery continua suportado. Builds/testes JS não equivalem a homologação em aparelhos.

## 8. Primeiros REDs mínimos, depois da revisão

**Rascunho disponível:** [checkpoint de um arquivo novo](../../continuidade/2026-11-04-mfa-reds-manifesto.json), seis casos revisados estaticamente, ainda sem execução, RED observado ou implementação. O controle de catálogo usa a função021; não demonstra que o flag deixe de conferir privilégios no suporte legado010. Resolver essa fronteira antes de fechar a obrigação administrativa e ampliar os negativos conforme necessário.



Começar por teste API/SQL em cópia isolada, sem alterar a main, com uma DB UUID do cluster owned e fixture oficial. O cluster está parado e host tem pouca memória: **não iniciar antes do guard de DB e da coordenação**. Não usar Playwright ou emulador ao mesmo tempo.

Primeiro lote delimitado de comportamentos ausentes na fonte atual:

1. Conta com flag administrativo e senha correta, sem fator: login devolve enrollment-required; `/organizations` e domínio protegido403; setup e logout continuam possíveis.
2. Conta sem flag, com binding global PLATFORM_ADMIN ativo: mesma obrigação. Controles binding futuro/expirado/revogado e role inativa não ativam obrigação; não basta olhar `Identity.role`.
3. Duas famílias sem fator: confirmar em A libera somente A; refresh/B e /me/B continuam verification-required, sem inventar prova por fator confirmado da conta.
4. Sessão normal promovida a admin: próxima operação/refresh e próxima entrega SSE ficam bloqueadas; remover autoridade volta ao estado aplicável sem conceder capacidade por si só.
5. Admin com fator confirmado não pode desativá-lo; mesmo código válido não remove fator/códigos. Não-admin conserva disable legítimo.
6. Chave MFA ausente, fator substituído durante prova e confirmação de geração pendente antiga falham fechados, sem escrita parcial ou prova indevida.
7. Promoção com a requisição já aguardando entre authenticate e assertGlobalCapability/inTenantContext: nova autoridade observada na operação não libera administração sem prova. Segunda posição da barreira, depois da revalidação inicial, exige rollback no ponto final antes do commit. **NÃO EXECUTADO.**

Asserções devem observar HTTP/estado persistido e códigos exatos, nunca falha por API de teste inexistente, erro de preparação ou import ausente. Congelar RED original, implementar delta aprovado e rodar GREEN na mesma fonte. Não enfraquecer fixtures/expectativas das suítes existentes para aceitar domínio de sessão restrita.

## 9. Matriz posterior e impacto legítimo das fixtures

Teste próprio: flag/binding, janelas, promoção, senha errada sem enumeração, ausência/pendência, código inválido/replay/concorrência, sessões A/B, refresh/reload, logout/recovery, falta de chave, ACL da identity e negativas das outras roles. Conferir que app não ganha UPDATE de sessões/fatores ou SELECT de bindings.

Adjacentes: mfa, recent-verification, session-lifecycle, password-recovery/change, auth-cookie, authorization-platform/time-windows, SSE; cliente/UI/mobile e tipos/fronteiras. Depois, API geral serial e Playwright auth/mfa, recent-verification, sessões/cookies nos três portais com os guards disponíveis.

Muitas fixtures existentes fazem login de administradores sem MFA. Depois da obrigatoriedade, esse comportamento não pode continuar como bypass de testes. Adaptar helpers de fixture com fatores/códigos sintéticos por conta/família e entrada pelo caminho real; separar os casos que intencionalmente validam sessão restrita. Para suites de domínio, seed de fator em DB UUID pode preparar a conta, mas login deve realmente consumir código; os testes do enrollment obrigatório percorrem HTTP completo. Não deixar flag de ambiente que desligue MFA no runtime. Registrar o impacto antes da integral para distinguir regressão real de setup antigo.

## 10. Rollout e limites

Migração068 aditiva, bootstrap/ledger/reaplicação e restauração atualizados por nova prova, sem editar migrations antigas. Servidor deve exigir schema compatível antes de servir a fonte nova; não fazer fallback para ausência das colunas/helper. Implantação coordenada precisa da chave MFA e do fluxo restrito disponível. Famílias antigas administrativas ficam restritas até provar o fator, mesmo se já existia fator confirmado; não backfill por confiança histórica.

Nenhum seed em produção. Sem bypass humano quando faltarem autenticador e recovery codes; recuperação assistida exige decisão/processo operacional separado antes da produção e não impede este recorte. Síndico obrigatório amplo, push, inbox separada, planos/assinaturas e homologação nativa não são entregues aqui.

**Revisão técnica interna e congelamento antes da implementação:** root confere contrato, geração/prova por família, allowlist de bootstrap, ACL do helper e matriz RED; em seguida a implementação segue o recorte atribuído e já autorizado pelo proprietário. Não é necessária nova aprovação do usuário para o requisito vigente. Este documento não autoriza aplicar068 em instalação existente nem constitui prova de segurança executada.

## 11. Pontos de alteração e ordem implementável

| Ordem | Arquivos/pontos | Entrega verificável |
| --- | --- | --- |
| 1 — RED dirigido | Novo `apps/api/test/platform-mfa-required.test.ts`; helpers de fixture próprios deste arquivo | Flag e binding administrativo, domínio403, duas famílias e disable negado. Contra a fonte atual, devem falhar pelo comportamento ausente, não pela preparação. **Ainda não executados.** |
| 2 — Persistência/ACL | Nova068; `packages/db/src/schema.ts:322`; teste SQL dedicado | Geração do fator, duas colunas de prova sem backfill, helper booleano exclusivo identity, seis roles preservadas; reaplicação e ledger68 conferidos. Nome068 é proposta, ainda não reservado/publicado. |
| 3 — Prova/estado | `auth/mfa-factor.ts`; `service.ts:38,54,67,95`; `mfa.ts:40,54,74`; `verification.ts:23` | Prova vinculada à geração, login/refresh avaliados por família, confirmação atual/CAS e sessão antiga bloqueada; janela055 intacta. |
| 4 — Fronteira HTTP/SSE | `auth/middleware.ts:18`; `auth/routes.ts:27,71,89`; `web-routes.ts:43`; `app.ts`; `events/routes.ts:27,44,83` | Default operacional fechado e bootstrap explícito, mesmo DTO em web/nativo/me, gate no heartbeat/evento/entrada. `resolveIdentity` pode devolver estado, mas os três caminhos SSE têm de exigir estado operacional antes de escrever. |
| 5 — Consumidores | `contracts/src/auth.ts`; `api-client/src/engine.ts:154`; `ui/src/api.ts`; `ui/src/auth-state.ts`; `ui/src/auth.tsx`; `ui/src/components/mfa-panel.tsx`; três `apps/*-web/src/App.tsx`; `mobile/src/app.tsx:135,248` | Motivo403 distinto não repete escrita; estado restrito desmonta leitores privados. Tela obrigatória antes dos providers, códigos de recuperação preservados até confirmação da pessoa, mobile orienta portal e bloqueia domínio. |
| 6 — Fixtures/regressão | `apps/api/test/fixture-login.ts:7,17`, `fixture-login.test.ts`, testes de auth e domínio listados abaixo; `e2e/support/fixtures.ts` e helpers | Preparação operacional explícita com MFA real/sintética por fixture, sem desligar gate no ambiente de teste, sem mudar budgets/retries existentes. |

Os pontos1–6 formam a entrega funcional; não publicar backend obrigatório sem avaliar a compatibilidade dos consumidores. Uma migration aditiva ou infraestrutura de prova publicada isoladamente deve ser identificada como preparação, não como MFA obrigatória entregue. Este plano está versionado antes do código funcional para preservar a continuidade entre máquinas.

## 12. Impacto estimado das fixtures e prioridades

Inventário estático da fonte atual: **81 arquivos de testes API**; **44** contêm `is_platform_admin`, `PLATFORM_ADMIN` ou o e-mail seed administrativo; **61** consomem `helpers`/`fixture-login`; **13** fazem requests diretas de login. São conjuntos sobrepostos de candidatos, não contagens de testes que falharão. O [inventário de fixtures](../../evidencias/platform-mfa-fixture-impact-2026-11-04.json) registra os caminhos; estes números não substituem execução nem estimativa exata de esforço.

Prioridade1: manter `mfa.test.ts` opcional (usuários sem autoridade administrativa), `recent-verification.test.ts`, `session-lifecycle.test.ts`, `web-sessions.test.ts`, `authorization-platform.test.ts`, `authorization-time-windows.test.ts`, `password-recovery.test.ts` e `password-change.test.ts`. Os novos casos obrigatórios usam requests explícitas; não passar por um helper que complete MFA automaticamente e esconda o estado sob teste.

Prioridade2: o helper compartilhado hoje envia apenas e-mail/senha e conserva o budget HTTP real com até três esperas de429 dentro de60s. Não alterar essa admissão. Criar preparação operacional de fixture explicitamente identificada, capaz de inscrever/confirmar MFA na mesma família e usar códigos próprios nos logins seguintes. Evitar criar uma família extra só para elevar a atual, pois testes de revogação/famílias contam essas linhas. Nunca marcar prova com UPDATE owner como atalho do comportamento que está sendo testado. Para testes de domínio, fatores sintéticos podem ser preparados na DB UUID, mas a entrada precisa consumir um código pelo fluxo real.

Prioridade3: E2E já possui aliases por cenário; manter isolamento por conta. Não copiar ciphertext entre usuários (AAD é o userId), nem usar um mesmo TOTP global em muitos cenários: o consumo único tornaria a suíte inválida. Usar fatores/códigos próprios de cada alias e acompanhar o challenge real; preservar o máximo de dez recovery codes por geração e não introduzir espera artificial ou bypass para contornar replay. Os casos de cadastro obrigatório continuam percorrendo a UI/HTTP completa.

Prioridade4: estados sintéticos de cliente/UI/mobile e foco/regras deverão declarar `mfaRequirement` conforme seu cenário; isso é atualização de contrato, não redução de expectativas. Acrescentar negativas de mudança de estado e resposta tardia, sem interpretar uma ausência do campo como prova de MFA válida. A segurança continua no servidor mesmo com cliente antigo, mas o rollout funcional precisa do gate atualizado.

## 13. Estado das decisões e próximos passos

**Decisões propostas para aprovação técnica:** geração UUID do fator; colunas de prova por família sem backfill; helper de autoridade estreito; enum explícito no DTO; bootstrap fechado por declaração de rota; proof/disable com geração e locks consistentes. **Ainda não comprovado por execução:** corridas de confirmação/substituição, escrita pós-consumo, promoção durante stream, todas as ACLs e comportamento dos consumidores. Não descrever a proposta como garantia já testada.

A última memória host informada por root foi **926 MiB**, abaixo dos guards. Portanto não reativar DB, browser, compilação ou qualquer job pesado agora. Primeiro portar/revisar o plano, preparar o pequeno arquivo RED em cópia isolada quando atribuído e aguardar condição de memória. Em seguida executar o lote dirigido sob a fixture oficial, preservar RED, implementar a entrega aprovada e completar a matriz. Nenhum segredo real, chave de produção, alteração de configuração global ou reinício é necessário para o desenho.
