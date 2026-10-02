# Avisos e agendamentos por capacidade — 025

> **For agentic workers:** usar subagent-driven-development e TDD, revisão de conformidade seguida de qualidade. Integrar após 024; o agente principal mantém documentação/Git.

**Goal:** migrar avisos e seus agendamentos para `notices:read`/`notices:manage`, preservando publicação, expiração, categorias e recorrência.

**Architecture:** leitura e gestão resolvem o aviso real no condomínio atual. Leitores recebem somente avisos publicados e não expirados; gestores com ambas as capacidades podem consultar os estados administrativos autorizados. Funcionalidades continuam independentes da descoberta básica e mutações revalidam após os locks.

**Tech Stack:** PostgreSQL, Express, Drizzle e schemas/testes existentes; sem dependência ou capacidade nova.

## Arquivos e limites

- Criar `infrastructure/025-notices-capabilities.sql` e `apps/api/src/modules/notices/authorization.ts`.
- Modificar `apps/api/src/modules/notices/routes.ts`; criar `apps/api/test/notices-capabilities.test.ts`.
- Regressões concretas em fixtures anteriores podem exigir concessão local explícita. Não afrouxar assertions de publicação, expiração, isolamento, feature pause ou auditoria.
- Reutilizar o recurso RBAC `notice` e os relógios de 021; não ampliar guards legados compartilhados, suporte temporário ou leitura de outros domínios. Workers de publicação/notificação durável continuam na etapa 3.

## Tarefa 1 — RED de HTTP e RLS

- [ ] Fixtures exclusivas em dois condomínios: pessoa/equipe sem membership legado, vínculo inteiro e aviso exato, morador, síndico em A/morador em B, administrador global/flag sem concessão local e outsider.
- [ ] Concessão exata não cria outro aviso nem promove gestão inteira. Plataforma não recebe conteúdo privado por seu papel global. Suporte sem capacidade de avisos permanece negado; não ampliar SUPPORT_CAPABILITIES.
- [ ] Testar publicados, futuros e expirados, categoria GESTAO, pinning e recorrência NONE/WEEKLY. Leitor não recebe draft/expirado nem schedule de aviso oculto por consulta SQL sem filtro. IncludeExpired/IncludeUnpublished exige gestão no escopo retornado.
- [ ] Mesmo JWT perde leitura/ação após revogação, expiração, papel/permission/equipe/membro/tenant inativos. Vigência de publicação usa relógio por statement, inclusive dentro de transação longa.
- [ ] Owner pode criar fixture inconsistente movendo o aviso para outro tenant; schedule que conserva o tenant anterior fica oculto. Não desligar triggers nem destruir dados anteriores.
- [ ] Registrar RED real antes de aplicar 025. Fixtures que retiram capacidades de catálogo restauram todos os campos, incluindo created_at textual com precisão PostgreSQL, em finally.

## Tarefa 2 — SQL e funcionalidades

- [ ] Helper pontual SECDEF STABLE com owner administrativo, search_path public,pg_temp e EXECUTE somente app; aceitar somente notices:read/manage e validar PK/tenant. UUID textual inválido retorna false sem cast que possa lançar erro nem oracle público.
- [ ] Helpers de escopo e de leitura de estado consultam concessões atuais inteiras ou candidatos reais por PK; não percorrer corpos/histórico de avisos para decidir acesso a funcionalidades. Estado permite leitura com notices:read mesmo sem buildings:read.
- [ ] Substituir as policies legadas de notices/notice_schedules por SELECT/INSERT/UPDATE/DELETE específicas. Leitura de conteúdo exige notices:read e janela publicada/não expirada, ou também notices:manage para estados administrativos; schedule valida o mesmo building/notice real e a visibilidade do pai.
- [ ] INSERT exige leitura/gestão inteiras e created_by correto. UPDATE/DELETE exigem ambas no aviso real. Restringir UPDATE de notices a campos editáveis de conteúdo/publicação e updated_at; ID, building_id, created_by e created_at ficam imutáveis ao app. Schedule não pode trocar sua identidade/tenant; preservar validação de recorrência/fuso e upsert existente.
- [ ] Acrescentar SELECT de estado de funcionalidades para o domínio. Estender apenas a branch local de app_can_read_feature_event com o novo direito de estado, preservando exatamente os demais domínios e marcador global de 022. Não conceder escrita de funcionalidades.
- [ ] Alterar somente actions NOTICE_SCHEDULED/PUBLISHED/UPDATED/DELETED da policy atual de auditoria: recurso/tenant/ator atuais e leitura/gestão necessárias, sem fallback legado. Demais actions permanecem intactas.
- [ ] Provar ACL/path/owner/STABLE, assinaturas e grants/policies fora do recorte preservados. Capturar EXPLAIN real pontual e de estado, sem histórico nem flags forçadas do planner.

## Tarefa 3 — handlers e concorrência

- [ ] Retirar assertBuildingAccess/buildingFeatures/assertFeature legados dos quatro handlers. Autorizar domínio, ler readFeatures sob lock compartilhado e conservar NOTICES/TRANSPARENCY por categoria; pausa continua ocultando conteúdo/negando gestão, sem defaults habilitados por settings escondidos.
- [ ] GET aplica escopo, filtros de categoria/publicação/expiração e DTO/nextOccurrenceAt existentes. Juntar schedule por notice_id e building_id. Consulta administrativa em escopo parcial retorna somente avisos gerenciáveis; não abre estados ocultos de outro recurso.
- [ ] POST usa ID do servidor, autoriza capacidade inteira, valida datas com relógio PostgreSQL por statement e lê a linha em statement seguinte ao INSERT. Aviso/schedule/auditoria confirmam juntos, sem depender de helper STABLE ver a linha em INSERT RETURNING.
- [ ] PATCH/DELETE fazem leitura/autorização sem lock primeiro; depois FOR UPDATE e novos statements para revalidar leitura/gestão após a espera. Inacessível/ID inválido retorna 404; visível sem ação retorna 403. Preservar expectedUpdatedAt/409 e updated_at do banco.
- [ ] Auditar DELETE antes da exclusão, enquanto a autorização pontual ainda resolve o aviso; confirmar auditoria e exclusão na mesma transação. Falha na exclusão/auditoria conserva ambos os estados anteriores.
- [ ] Esperas reais e limitadas por row lock: revogar/expirar pessoa/equipe durante espera impede escrita e auditoria. Rollback de falha de auditoria também conserva schedule. Limitar aquisição, observar rejeições e soltar locks em finally, seguindo as provas de 021.
- [ ] Mapear erros PostgreSQL a mensagens genéricas; não registrar SQL/params de título/corpo nem conteúdo estrangeiro em erro.

## Tarefa 4 — integração

- [ ] Aplicar/reaplicar atomicamente somente 025 no banco isolado preservado localhost:5436, flags de integração e concorrência1. Dirigido de notices-capabilities, parking-notices, parking-notices-unit, governance, feature-enforcement, features-lifecycle, authorization-time-windows, RBAC e tenancy; conferir nomes com rg --files.
- [ ] API tipos, fronteiras e diff-check; comparar catálogo inclusive precisão dos timestamps restaurados e confirmar fixtures/transações/locks zero. Conformidade, qualidade e correções/revisões.
- [ ] Agente principal executa API integral sobre fonte estável/banco livre, atualiza tracker/AUTORIZACAO e faz commit/push autorizado. Próximo recorte: ocorrências e seus históricos/grupos; reservas, financeiro, configuração/atuação e administração seguem pendentes.

Estado: planejado após inspeção de routes.ts, notices/notice_schedules, migrations 002/009/011 e testes de avisos existentes. Não implementado nem validado; depende de 023/024 e não encerra o plano total.
