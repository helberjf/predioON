# Chamados, históricos e grupos por capacidades — 026

> **For agentic workers:** usar subagent-driven-development e TDD; conformidade antes de qualidade. O agente principal integra documentação e Git. Executar após 023/024/025; não alterar migrations anteriores.

**Goal:** migrar `/occurrences`, sua linha do tempo e atendimento agrupado para concessões atuais, preservando a privacidade de cada solicitante.

**Architecture:** `occurrences:read-own` resolve o autor real do chamado; `occurrences:manage` resolve o chamado real para gestão, inclusive concessões específicas. RLS protege o par condomínio/chamado e seus eventos. Cancelamento e atualização do timestamp pelo solicitante usam rotinas estreitas; leitura própria não concede UPDATE administrativo.

**Tech Stack:** PostgreSQL, Express, Drizzle e testes TypeScript existentes. Nenhuma dependência ou nova permissão de catálogo.

## Decisões e arquivos

O morador vê somente os chamados que abriu e os eventos destinados a esses chamados, inclusive quando existe atendimento agrupado. Manutenção sem concessão de gestão também vê somente seus próprios chamados. `assigned_to` não concede leitura automaticamente; a etapa de ordens de serviço definirá a projeção do trabalho atribuído, sem publicar relatos privados dos demais solicitantes. Síndico e gerente com `occurrences:manage` podem gerir seu escopo. Plataforma global e suporte técnico não recebem conteúdo deste domínio sem concessão local permitida pelo catálogo atual.

Criar exige `occurrences:create-own` e `occurrences:read-own` inteiras no condomínio para abrir e acompanhar a própria solicitação; concessão em chamado existente não permite criar outros chamados. Leitura própria exige simultaneamente `opened_by = app_current_user_id()` e `occurrences:read-own` para aquele chamado. Gestão específica permite ler/gerir somente o recurso concedido. Não exigir `buildings:read`/`buildings:manage` para operar o domínio, nem ampliar os helpers legados compartilhados.

Criar `infrastructure/026-occurrences-capabilities.sql`, `apps/api/src/modules/occurrences/authorization.ts` e `apps/api/test/occurrences-capabilities.test.ts`; modificar `apps/api/src/modules/occurrences/routes.ts`. Ajustes de fixtures existentes somente por regressão demonstrada, mantendo verificações de privacidade, cálculos, pausa e auditoria. Dashboard/UI de capacidades são integração posterior; não antecipar mudanças nos contratos de 024 neste recorte.

## Tarefa 1 — RED real de HTTP/RLS

- [ ] Fixtures próprias com dois condomínios, solicitantes diferentes, gestor individual/equipe sem membership legado e grupos com membros abertos/encerrados. Criar também eventos com `building_id` incoerente via owner para provar que o app não os lê.
- [ ] Leitura/criação própria funciona sem membership legado. Não revela relato, autor, comentário, IDs ou quantidade de chamados alheios, nem amplia leitura por `assigned_to`, `group_id`, descoberta básica, flag global ou concessão somente em outro chamado.
- [ ] Gestor específico lê/edita apenas seu chamado, não cria por essa concessão e não comenta/altera silenciosamente parte de um grupo não autorizado. Gestor de equipe perde acesso ao desativar membro/equipe; conta/tenant/role/permission inativos, vigência futura e concessão revogada negam com o mesmo JWT.
- [ ] Preservar comportamento existente: morador comenta seu chamado e cancela somente enquanto aberto; não altera gravidade, responsável ou grupo. Gestor altera gravidade com motivo; editar outro campo conserva `closed_at`; atualização coletiva preserva vizinhos encerrados.
- [ ] Registrar falhas antes da migration. Exemplos:

```ts
assert.equal((await f.request(f.worker, `/occurrences?buildingId=${f.a}`)).status, 200);
assert.equal((await f.request(f.resident, `/occurrences/${f.neighborsTicket}`)).status, 404);
assert.equal((await f.request(f.specificManager, `/occurrences/${f.groupedTicket}`, 'PATCH', { status: 'DONE', applyToGroup: true })).status, 403);
```

## Tarefa 2 — policies, helpers e mutações próprias

- [ ] Remover somente as policies legadas `occurrences_scope_policy`, `occurrences_active_access`, `occurrence_events_scope_policy` e `occurrence_events_active_access`. Não retirar proteções de financeiro, reservas ou outros domínios que ainda usam governance.
- [ ] Helper pontual do chamado: UUID textual inválido retorna false usando CASE antes do cast; consulta por PK e building real; aceita somente `occurrences:read-own`/`occurrences:manage`. Read-own verifica autor real. SECDEF/STABLE, mesmo owner do RBAC, search_path public,pg_temp; execução somente app, sem oracle de existência para atores sem concessão.
- [ ] Helper de escopo aceita concessão inteira read-own/manage e escopo parcial com pelo menos um chamado real autorizado. Read-own inteira pode retornar lista vazia antes de abrir o primeiro chamado. Create-own isolada não libera lista/histórico e a criação HTTP é negada ao faltar read-own; testar as permissões separadamente.
- [ ] SELECT de chamados: gestão real ou autor+read-own. INSERT: create-own/read-own inteiras, `opened_by` igual ao ator, estado OPEN, sem grupo/responsável/alerta fornecidos pelo cliente. UPDATE direto somente manage; grant de colunas somente `status`, `priority`, `assigned_to`, `group_id`, `closed_at`, `updated_at`. Identidade, tenant, protocolo, autor, texto e criação imutáveis pelo app; DELETE revogado.
- [ ] Eventos SELECT validam o pai real e `building_id` exato; INSERT exige pai autorizado e `author_id` igual ao ator. Solicitante insere somente COMMENT/CREATED; transições administrativas exigem manage. UPDATE/DELETE de eventos revogados ao app, identity e broker: histórico append-only.
- [ ] Implementar `app_occurrence_cancel_own(text,uuid)` VOLATILE SECDEF com autorização própria antes de bloquear, lock da linha e verificação nova após esperar usando instante `clock_timestamp()` gerado no servidor com `app_has_capability_at` interno. Só muda chamado próprio aberto para CANCELLED e seus timestamps, anexando STATUS_CHANGED com ator/tenant/texto da transição gerados a partir da linha real. O handler não duplica esse evento. Sem argumentos de status, autor, tenant novo ou timestamp. Chamado já encerrado continua 409; perda de concessão não produz mudança.
- [ ] Implementar `app_occurrence_touch_own(text,uuid)` com a mesma revalidação após lock, alterando somente `updated_at` do chamado próprio autorizado para registrar comentário. Não conceder UPDATE amplo a quem lê próprio chamado. Rotinas não aceitam instante do cliente e permanecem na transação do handler, de modo que evento/auditoria e mudança confirmem ou revertam juntos.
- [ ] Helpers de grupo retornam somente autorização booleana do conjunto real `building_id/group_id`, sem lista de IDs ocultos: ação coletiva exige manage em todos os membros reais antes de qualquer efeito. Não usar quantidade do SELECT filtrado por RLS como prova de cobertura integral.
- [ ] Projeção mínima booleana de responsável valida conta ativa e vínculo local atual individual, membership ou equipe, com tenant e role ativos e janelas 021. Não expõe diretório de usuários; atribuir não concede leitura. Usar o relógio atual, substituindo a consulta legada baseada em `now()`.
- [ ] Policies aditivas de estado de funcionalidades permitem leitura pelo escopo real deste domínio. Estender somente a expressão local de `app_can_read_feature_event` vigente após 025; conservar a expressão global e as branches de telemetria/alertas/equipamentos/avisos.
- [ ] Auditoria: substituir somente OCCURRENCE_UPDATED/COMMENTED e OCCURRENCES_GROUPED no CASE vigente. A primeira aceita gestão ou cancelamento próprio estreito; comentário exige chamado real legível e grupo integral quando coletivo; agrupamento exige concessão em todos os chamados reais do grupo. Não criar tipo RBAC occurrence_group nem permitir fallback legado dessas ações. Demais branches permanecem idênticas.
- [ ] Aplicar/reaplicar somente 026 atomicamente com ON_ERROR_STOP/single-transaction. Comparar catálogo, ACLs e policies alheias; provar PK no helper pontual e ausência de scan do histórico para avaliar escopo/grupo. Funções privadas de relógio continuam inacessíveis aos runtimes.

## Tarefa 3 — handlers, funcionalidades e concorrência

- [ ] Retirar assertBuildingAccess/buildingRole/scopedBuildingIds/assertFeature/filterFeatureRows legados deste módulo. Autorizar domínio antes de readFeatures, conservar lock compartilhado de funcionalidades e TICKETS/TICKET_PRIORITY/TICKET_GROUPING por operação. Testar estados após retirar buildings:read/manage do papel, sem default habilitado por RLS escondida.
- [ ] Listagem usa RLS atual, filtros de status/onlyOpen e ordem/paginação existentes. Sem buildingId, resolver somente tenants atuais deste domínio; filtrar pause antes da paginação. Detalhe junta timeline pelo par building/chamado. Antes de enviar conteúdo já em memória, revalidar os recursos atuais em statement final; ID malformado preserva 400, oculto/inexistente 404 e ação insuficiente sobre recurso legível 403.
- [ ] POST exige create-own/read-own inteiras, gera UUID no servidor e protocolo pela sequência existente, insere chamado e depois consulta em statement novo. CREATED pertence ao autor e ao tenant real; erros revertem chamado/evento. Preservar prioridade NORMAL quando funcionalidade de gravidade está pausada; não resetar/reusar sequência.
- [ ] PATCH/comentário autorizam primeiro sem lock. Depois lock advisory existente por condomínio e row locks em ordem estável; revalidar em statements novos após qualquer espera antes de alterar ou inserir evento. Cancelamento/touch próprios chamam rotinas estreitas; gerente/síndico usam UPDATE sujeito à policy manage. Comentário próprio, cancelamento e auditoria confirmam na mesma transação.
- [ ] Agrupamento manual conserva 2..50 IDs distintos, mesmos tenant e estado aberto/não agrupado, 404 para IDs ocultos e 409 para conflito. Autorizar cada chamado antes de locks e revalidar depois; não herdar permissão de um membro para outro. Sugestão de duplicidade considera somente chamados gerenciáveis autorizados, conserva normalização e limite atual, sem contagem de relatos ocultos.
- [ ] applyToGroup exige cobertura de todos os membros reais, mesmo quando o SELECT de RLS vê um subconjunto. Revalidar o conjunto depois de locks antes de efeitos; alteração de status/gravidade continua ignorando vizinhos encerrados. Resposta coletiva cria evento separado por destinatário, sem copiar nomes/textos privados de outros relatos.
- [ ] Testes de espera advisory e row lock observam pg_locks/pg_stat_activity, têm aquisição/consulta limitadas e finally que libera locks e observa rejeições. Revogação/expiração de pessoa/equipe durante espera impede mudança, histórico e auditoria; erro na auditoria reverte todas as linhas de grupo. Nenhum retry do resultado de autorização.
- [ ] Mapear erros PostgreSQL genericamente sem SQL/params ou conteúdo privado nos logs. Não alterar ingestão, criar ordens de serviço, publicar relatos como avisos ou emitir comandos físicos.

## Tarefa 4 — integração e publicação

- [ ] Dirigido serial: occurrences-capabilities, governance, feature-enforcement, features-lifecycle, authorization-time-windows, RBAC e tenancy; confirmar arquivos com rg --files. Testar SQL app sem WHERE, DML de identidade/tenant/autor/protocolo negado e INSERT de evento em pai/tenant alheio negado.
- [ ] Fixtures restauram catálogo inclusive `created_at::text` sem arredondar microssegundos. Banco isolado localhost:5436 preservado; cleanup de fixtures/transações/locks e grants/policies fora do recorte conferidos.
- [ ] API typecheck, fronteiras e diff-check; conformidade seguida de qualidade e correções/revisões. Agente principal roda API integral sobre fonte estável e DB livre, atualiza AUTORIZACAO/tracker e faz commit/push por meta validada.

Estado: planejado a partir dos handlers atuais, policies 002/011, catálogo RBAC e design aprovado de chamados privados/atendimento agrupado. Não implementado nem validado. Depende dos recortes anteriores e não encerra 2B.3 ou o plano total.
