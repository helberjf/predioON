# Próximos lotes MFA após as três consultas de funcionalidades

Inventário estático de 07/11/2026. Não é uma prova de exploração nem um aceite funcional. Nenhum Node, banco, teste, serviço ou compilador foi executado para esta nota. O produto deste diretório continua congelado; este arquivo não amplia o delta.

Fonte examinada: `work/mfa-support-read-v2-fixed-qa-20261107/source`, prepared SHA-256 `72303310e31c365ef9e2b43ccde9007c53d3e85d74d33c2174d15ad95ac16fde`, 1.025 arquivos na `composedFreeze`. Referências de código abaixo são relativas a essa fonte, não às linhas do produto candidato; `modules/...` abrevia `apps/api/src/modules/...`. O delta de funcionalidades altera somente `apps/api/src/modules/features/routes.ts`, after SHA-256 `d37a9cc3caaab826cde759da83efd107e7de8a2c9343fc887526031fdb591141`. Seu aceite de tipos/DB pertence à execução separada do coordenador.

Documentos de partida: `docs/superpowers/plans/2026-11-05-mfa-admin-config.md`, `2026-11-05-mfa-fechamento-e-demonstracao.md`, `2026-11-05-mfa-inventario/README.md` e `2026-11-07-mfa-features-read.md`. O inventário de 174 declarações é histórico e heurístico; não deve ser republicado como contagem atual de operações aprovadas. Leituras de tenancy/suporte e gateway/heartbeat avançaram depois daquele snapshot. Os comandos continuam separados.

## Precedência imediata: precisão da ordenação de suporte

A auditoria paralela comunicou um caso funcional ainda pendente: as ordenações externas das listas de suporte usam `createdAt`/`expiresAt` já formatados em milissegundos. Duas linhas cujo timestamp original difere apenas em fração inferior a um milissegundo podem passar a empatar no campo JSON; o desempate pode então inverter a ordem nativa, mesmo existindo ORDER BY interno por timestamp. Esse caso deve receber fixture discriminante, correção isolada e prova real **antes de otimizar o desempenho dessas listas**. Não consta como resolvido nesta nota e não faz parte do delta de funcionalidades. Conferir o novo freeze de suporte antes de compor qualquer lote posterior.

## Próximo incremento de domínio recomendado: edição e estado de blocos, unidades e equipes

Começar por **seis PATCHs**, os três `/:id` e os três `/:id/status` de blocks/units/teams. Eles convergem em duas funções existentes e oferecem os dois modelos necessários: escrita com alvo ausente e mudança que pode retirar a própria permissão do ator. É um recorte menor e mais verificável que introduzir um executor universal de comandos.

| Fronteira atual | Evidência | Proteção já existente | Trabalho necessário |
| --- | --- | --- | --- |
| `edit` | `modules/tenancy/routes.ts:375` | Busca pelo RLS do leitor, capacidade antes do UPDATE, filtro de ativo, RETURNING, auditoria obrigatória na mesma transação | Decisão MFA observável com alvo inexistente e junto à escrita efetiva; preservar404 para ator satisfeito/escopo oculto e todos os campos públicos |
| `setStatus` | `modules/tenancy/routes.ts:419` | Visibilidade, capacidade, busca com `FOR UPDATE`; mantém histórico; auditoria antes da escrita para permitir desativar equipe que concede a própria gestão | Reavaliar a decisão depois da espera pelo lock, proteger o caminho sem alteração (`current.active === active`) e a resposta; não inserir um postcheck de capacidade que invalide autorrevogação legítima |
| Auditoria de estrutura | `infrastructure/041-tenancy-edit-audit.sql` | Acrescenta ações de editar/desativar/reativar às provas de auditoria existentes; não concede UPDATE por si só | Preservar ownership/ACL/políticas, ações, ordem e rollback; não editar041 nem reduzir a prova de auditoria |

`setStatus` atualmente retorna uma nova leitura sem UPDATE quando o estado já coincide. Esse ramo faz parte do contrato a proteger. `edit` e `setStatus` também devolvem404 antes de qualquer escrita quando o primeiro SELECT não encontra o alvo; uma guarda apenas em linhas atualizadas não cobre esse caso. ID malformado é rejeitado antes de entrar na transação; manter explicitamente a classificação de validação de entrada, em vez de confundi-la com alvo UUID válido inexistente.

Desenho ainda a provar: operação nomeada por família, com parâmetros fechados, guarda independente da cardinalidade, capacidade/efeito vinculados ao statement apropriado e resultado escalar explícito. Se usar CTE de DML, a guarda precisa ser dependência real do DML **e** da resposta vazia; não basta uma CTE declarada mas não referenciada, nem `WHERE guard()` sobre zero linhas. Fazer o ensaio RED/controlado antes de consolidar uma abstração. `readMfaRows` é somente leitura: não transportar UPDATE, função VOLATILE mutadora ou callback arbitrário por esse helper.

Matriz mínima do lote:

1. PMF01/PMF02 depois da última decisão real de autorização, em edição e estado; registrar se a barreira está antes ou depois da aquisição efetiva do lock.
2. Alvo existente, UUID válido inexistente, registro inativo, tenant estrangeiro e estado já desejado; comparar404/403 e zero efeitos/auditoria nos casos negados.
3. Espera real por lock, promoção administrativa ou perda da prova durante a espera, seguida da decisão final. Um atraso artificial antes do SELECT não prova esse caso.
4. Gestor opcional e administrador satisfeito; desativação da própria equipe continua permitida e auditada uma vez; a próxima operação perde acesso.
5. Falha de auditoria provoca rollback da escrita; resposta conserva view pública; nenhum retry automático.

Regressões concretas para inventariar/adaptar localmente: `tenancy-edit.test.ts` (inclui autorrevogação, auditoria e reexecução041), `tenancy-http.test.ts`, `tenancy-people.test.ts`, `building-discovery-resources.test.ts`, `rbac-db.integration.test.ts`. As chamadas SQL diretas de prova ACL não devem ganhar um SID inventado. Testes HTTP administrativos precisam cerimônia MFA real no próprio bearer/SID. Os testes originais não devem perder assertivas para aceitar o novo gate.

## Fila seguinte de comandos administrativos

| Ordem | Recorte finito | Pontos que precisam permanecer corretos |
| --- | --- | --- |
| 2 | Criação de blocks/units/teams e vínculos; revogação dinâmica de unit-memberships/team-members/role-bindings | `tenancy/routes.ts:220,244,268,292,316,352,527`. Revogação usa `FOR UPDATE`,204 idempotente e auditoria antes de perder a própria permissão. Inclusão em equipe tem upsert e checagem de elegibilidade060. Não transformar052/serviços em humanos |
| 3 | Convites e usuários/memberships | `tenancy/routes.ts:483,509` e `users/routes.ts:104,138`. Convite pode revogar anteriores, inserir novo, auditar e enviar e-mail depois da transação; aceitar/revogar concorrentemente não deve criar auditoria falsa. Membership upsert restaura janelas expiradas e preserva janelas ainda vigentes. `requireRecentVerification`055 é requisito adicional, não prova TOTP |
| 4 | Suporte: staff + concessões | `support-access/routes.ts:103,123,155,193`, `revokeGrant:83`. Criação da primeira concessão trava o binding de staff; remoção de staff usa o mesmo binding, depois fecha concessões. Preservar ordem e substituição por capability, limite de sete dias, ausência de autoconcessão e append-only. DELETE de grant evita deliberadamente `FOR UPDATE`, pois esse lock aplica uma policy que oculta grant já revogado; o UPDATE condicional resolve a concorrência. Não trocar isso mecanicamente por lock genérico |
| 5 | Organizações, prédios, dispositivos/gateways/métricas/credenciais | Organização PATCH usa `FOR NO KEY UPDATE` para manter FK concorrente e rechecagem após espera (`organizations/routes.ts:93`). Equipamentos releem por RLS após `FOR UPDATE`, refazem capacidade e validam associação device/gateway (`devices/routes.ts:94,128`; `gateways/routes.ts:71,110`). Manter segredos fora de DTO/log e ordem das verificações. RLS MFA já cobre linhas de organizations/devices/gateways/device_metrics; isso não encerra todos os vazios e no-match |

Esses lotes precisam abranger também as projeções retornadas pelas mutações. O aceite dos GETs separados não protege automaticamente o SELECT de resposta dentro de um POST/PATCH. As exceções e mapeamentos de erro atuais (`inTenancy`, `inSupport`, `equipmentWrite`, `organizationOperation`) devem continuar convertendo PMF01/02 antes de um wrapper genérico produzir500. `inTenantContext` já traduz esses erros; preservar a posição do wrapper e testar o código retornado.

## Funcionalidades: um comando de domínio, não mais guardas por chave

Os dois PUTs convergem em `modules/features/routes.ts:47` da fonte congelada (`update`). Eles estão deliberadamente intactos no candidato de três GETs. O próximo incremento específico deve cobrir ambos em conjunto: escopo global/prédio, versão, upsert, transições, auditoria, notificação e resposta.

- `lockFeatureChanges` é exclusivo e `inTenantContext` usa `lockFeatures` compartilhado nas leituras. Isso já serializa comandos HTTP de configuração. Não afirmar que três SELECTs de `readFeatures` geram incoerência sob esse protocolo normal.
- O lock de funcionalidades não serializa escritores de flag administrativa, bindings, fatores MFA ou prova da sessão. Não usá-lo como garantia universal de identidade.
- O comando verifica versão antes do upsert e pode atingir zero condomínios na forma global; também pode não produzir transições porque o estado efetivo não mudou. A guarda deve permanecer observável nesses casos e antes de devolver409/404 derivado de dados, conforme o contrato que for aprovado.
- A definição vigente de `app_apply_feature_transition` está em `infrastructure/038-durable-alert-delivery.sql:400`, é `VOLATILE SECURITY DEFINER`, toma o advisory lock, usa relógio real e refaz a capacidade depois do lock. Faz efeitos em runtime, consumo, estacionamento, comandos de portão e entregas. Não basta envelopar sua chamada em um SELECT cuja guarda foi calculada antes dos snapshots internos.
- Preservar a confirmação de persistência da transição, rollback de todos os efeitos/auditoria e entrega de `pg_notify` apenas no commit. Não aplicar replay para contornar40001. As alterações de funcionalidades precisam continuar coordenadas com ingestão/entregas/acesso sem exigir sessão humana de workers.

Critério: global/building, conflitos de versão, alvo ausente, nenhum prédio, intenção local nullable, nenhuma mudança efetiva, lock real e promoção/remoção de prova; rejeição deixa configurações/runtime/cursors/comandos/entregas/auditoria/notificações inalterados. Conservar `features-config`, `building-feature-capabilities`, `features-unit`, `features-lifecycle` e `feature-enforcement`, cada qual após inventário dos atores HTTP e SQL diretos. Incluir regressões de entregas/ingestão somente em execução coordenada e com fonte congelada.

`demo/routes.ts:19,31` é um recorte vizinho, separado: leitura de `demo_scenarios` e `app_demo_scenario_set`062. GET `/demo` devolve somente a flag de configuração; classificar como metadado. O domínio está condicionado a `DEMO_SCENARIOS`; não ligar modo demo em produção para testar. Examinar efeitos internos do mutador antes de reutilizar desenho de features.

## Leituras privadas e domínios operacionais ainda separados

Em paralelo ao desenho dos comandos, há outro recorte de implementação possível: HTTP privado do grupo C. O aceite dos projectors SSE não se transfere aos handlers HTTP.

| Família | Callers reais identificados | Próxima análise necessária |
| --- | --- | --- |
| Alertas e regras | `alerts/authorization.ts:20` chama `app_alert_authorized_contexts`; `alerts/routes.ts:20` lista,54–59 transita | Separar leitura/feature state da transição VOLATILE `app_transition_alert`; preservar capability, limites e persistência. Conferir definitions/owner/snapshots dos readers antes de readMfaRows |
| Telemetria | `telemetry/routes.ts:49,96`: latest/series, `app_telemetry_authorized_devices`, `app_published_water_levels` | Latest mistura privado/publicado; series descobre dispositivo antes de buscar séries. Preservar contrato de autorização por recurso, catálogos e limites; zero linhas e dispositivo ausente precisam decisão guardada |
| Monitoramento | `monitoring/routes.ts:27,50,73`; `monitoring/authorization.ts:11,17` | Publicação de consumo é opt-in de morador e usa helpers próprios. Reunir decisões necessárias com a projeção, preservando datas/unidades/null e fallback. PUT resident-access chama mutador separado; não cobri-lo por aceite dos GETs |
| Auditoria/finanças/overview local | `audit/routes.ts:14` resolve escopo antes da lista; `finance/routes.ts:57` lista; overview local é distinto dos health globais já envelopados | Preservar redaction/visibilidade, versões e publicação financeira. Identificar dependências SQL STABLE/IMMUTABLE por nome/overload e fluxo, não só por regex |
| Reservas/áreas/ocorrências/avisos/ordens/ativos/eventos/automações | Grupo D do inventário; `reservations/routes.ts:100,115,127,137,160,191,207` exemplifica leituras e comandos diferentes | Reservas incluem disponibilidade SD, calendário privado, unidade própria, criação, decisão e cancelamento próprio (`app_cancel_own_reservation`). Manter exclusão/conflitos, limites por unidade, privacidade e atribuição. Readers precisam levantamento separado de mutadores |
| Acesso físico e estacionamento | `access/routes.ts:470,518,531,553,571`; `parking/routes.ts:118,160,196,260` | Fronteira específica de efeito físico. `app_request_access_admit`059 usa locks compartilhado de features, por ator e portão, relógio pós-espera, deduplicação por requestId e rechecagens. Preservar ordem, QR/generation, throttling e serviço de comando; nenhum replay automático ou gate humano no totem/broker |

O helper readMfaRows aceita somente SELECT do servidor com dependências relacionais estáveis revisadas. As exceções já documentadas de `clock_timestamp()` em convites/concessões não autorizam automaticamente novos leitores VOLATILE. DTO explícito e decisão MFA independente de linhas continuam obrigatórios, incluindo retorno default. Quando uma resposta inclui múltiplos contextos, nomear se há um snapshot único ou snapshots intencionais; demonstrar a propriedade alegada com teste apropriado.

## Condições de fechamento

Não ampliar068 candidata nem publicar política obrigatória na main somente porque o próximo lote passar. Atualizar o mapa por operação real, anexar fontes/hashes/RED/GREEN e limites; executar regressão integrada na mesma composição antes do rollout. Bootstrap/enrollment/recovery/logout/revogação de sessões, serviços MQTT/ingestão/notificação e totem são exceções explícitas a revisar, não alvos de uma exigência universal de SID.

Depois da matriz backend: tipos de todos os consumidores, fluxos MFA/recovery/sessão reais, Playwright com PostgreSQL/API dos três portais e motores em série, aceites nativos Android/iOS separados, operação/backup/restore, plano de deploy e novas demonstrações. Nenhuma aprovação SQL isolada equivale a aceite mobile/web de produção. Manter guards de memória e execução pesada serial, sem reiniciar computador, Docker ou WSL.
