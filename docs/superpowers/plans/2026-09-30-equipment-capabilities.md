# Equipamentos e gateways por capacidade — plano de implementação

> **For agentic workers:** usar subagent-driven-development, TDD e revisões de conformidade e qualidade. O agente principal atualiza documentação e integra por commit/push; implementador não altera Git.

**Goal:** migrar leitura, configuração e emissão de credenciais de equipamentos para autorização atual no condomínio/recurso.

**Architecture:** policies SELECT/INSERT/UPDATE separadas substituem as policies ALL legadas. Helpers restritos validam o recurso real e a relação dispositivo/gateway, sem promover permissões entre recursos. Rotas preservam DTOs/caminhos e auditam alterações na mesma transação, com locks e revalidação após espera nas alterações existentes.

**Tech Stack:** Express, Drizzle e PostgreSQL existentes, sem nova dependência.

## Dependência e arquivos

Executar após o recorte corretivo 019 estar aprovado/verificado. Banco isolado localhost:5436; aplicar somente 020 atomicamente. Não aplicar seed/db:push/reset nem migrations antigas.

- Criar infrastructure/020-equipment-capabilities.sql.
- Criar apps/api/src/modules/equipment/authorization.ts para consultas de autorização próprias do domínio.
- Modificar apps/api/src/modules/devices/routes.ts e apps/api/src/modules/gateways/routes.ts.
- Criar apps/api/test/equipment-capabilities.test.ts.
- Compatibilidade identificada na regressão integral: modificar apps/api/src/modules/access/routes.ts somente na leitura mínima do hardware de portão existente; adicionar helper protegido à própria 020. Modificar fixtures de access.integration.test.ts e features-lifecycle.test.ts e o caso 17 de building-discovery-resources.test.ts conforme critérios abaixo. Não migrar a atuação física inteira neste recorte.
- Modificar somente fixture de apps/api/test/mqtt.test.ts: o administrador global do teste de proteção de hashes precisa receber concessão local explícita no gateway de teste. Preservar as asserções de hash ausente e PATCH de credencial recusado; limpar a concessão ao encerrar.
- Adaptar somente o caso de classificação gate/parking em apps/api/test/telemetry-capabilities.test.ts: seu objetivo continua ser provar classificação sem SELECT de configuração. Usar suporte com concessão apenas telemetry:read no tenant no lugar de manutenção (que agora legitimamente lê devices). Preservar devices.length=0 e todas as asserções de pausa/classificação; não transformar a negativa em expectativa de leitura permitida.
- Não alterar catálogo, modelos compartilhados, credenciais de runtime, broker, ingestão, políticas de outros domínios ou consumers web neste recorte. SSE de device-status/gateway-status será recorte dependente. O agente principal registra as limitações dos painéis até sua migração integrada.

## Capacidades e escopo

Usar devices:read e devices:configure existentes no catálogo. BUILDING_ADMIN recebe ambas; manutenção e seu responsável leem; residentes não recebem configuração técnica. Suporte continua somente devices:read diagnóstico. Plataforma sem concessão local explícita não acessa equipamentos privados nem emite credenciais.

devices:read/configure em device autoriza somente esse dispositivo e suas métricas. Em gateway autoriza somente esse gateway. Não herdar automaticamente leitura/configuração entre dispositivo e gateway. Permissão inteira do condomínio autoriza todos os recursos existentes daquele condomínio; resource_type building não equivale a permissão inteira.

- Device precisa pertencer ao building declarado; gateway_id não nulo também deve existir nesse building. Dado inconsistente inserido pelo owner não pode ser exposto/configurado.
- Gateway precisa pertencer ao building declarado. Device metric precisa ter building_id igual ao do device real.
- Recurso desativado pode ser lido/configurado para diagnóstico e reativação. Conta, tenant, organização, papel, equipe, binding e suporte precisam estar vigentes.
- Pausa de funcionalidade não apaga configuração de inventário; atuação física continua sendo responsabilidade dos módulos de comandos e seus locks.

## Tarefa 1 — RED de leitura e configuração

- [x] Fixtures reais únicas em dois tenants, pessoa direta/equipe, device/gateway específicos, síndico A/morador B, suporte diagnóstico, global sem concessão e legado compatível.
- [x] Demonstrar manutenção sem membership bloqueada pelos handlers anteriores e leitura indevida de global/residente. Provar isolamento em SELECT PostgreSQL sem filtro e HTTP.

```ts
assert.equal((await request(worker, `/devices?buildingId=${a}`)).status, 200);
assert.deepEqual((await request(scopedDevice, '/devices')).body.items.map(d => d.id), [deviceA]);
assert.deepEqual((await request(scopedDevice, '/gateways')).body.items, []);
assert.equal((await request(resident, `/devices?buildingId=${a}`)).status, 403);
assert.equal((await request(scopedDevice, `/devices/${deviceB}/metrics`)).status, 404);
```

- [x] Exercitar zero recursos com capacidade inteira (200 vazio), tenant explícito sem leitura (403), global/flag forjados sem concessão, recurso estranho/inexistente e relação estrangeira criada pelo owner.

## Tarefa 2 — migration e leitura GREEN

- [x] Criar helpers booleanos por ID real, whitelist somente devices:read/configure, SECURITY DEFINER STABLE, search_path public,pg_temp, owner administrativo de app_has_capability. Revogar PUBLIC/identity/broker; conceder app somente aos helpers que também fazem autorização atual. Validação pura de pertencimento não pode virar oracle acessível à aplicação.
- [x] Helper de escopo de listagem deriva concessões atuais do próprio usuário/equipes/suporte e valida dispositivo/gateway por ID; não usar descoberta básica como autorização técnica. Tipo de lista diferencia device e gateway. Grant válido não promove acesso ao tenant inteiro.
- [x] Substituir devices_scope_policy/gateways_scope_policy/device_metrics_scope_policy por SELECT, INSERT e UPDATE específicas TO predioon_app. DELETE em devices/gateways e UPDATE/DELETE em métricas não têm endpoint e devem ser revogados. Não alterar policies identity/broker de 015 nem ownership/privilégios dos processos proprietários.
- [x] devices SELECT exige devices:read no dispositivo; gateways SELECT no gateway; métricas SELECT no dispositivo relacionado, validando ambos os building_id. Consultas pontuais usam PK; não consultar histórico de telemetria/alertas.
- [x] GET /devices mantém filtro opcional buildingId e ordenação. GET /gateways preserva lista autorizada e sanitização mqttUsername/mqttPasswordHash. GET /devices/:id/metrics usa RLS e retorna 404 para dispositivo inacessível/ausente. Remover scopedBuildingIds/assertBuildingAccess/requireRole destes caminhos.
- [x] Aplicar/reaplicar 020 com psql -v ON_ERROR_STOP=1 --single-transaction, sem BEGIN/COMMIT no arquivo. Registrar checks de grants, owner e reexecução.

## Tarefa 3 — configuração, credenciais e auditoria

- [x] POST /devices e POST /gateways exigem devices:read + devices:configure inteiras no tenant; gerar ID no servidor. Não usar papel global ou flag como bypass. Preservar payload/DTO e validação existente.
- [x] PATCH existente exige leitura do recurso por RLS (404 ausente/inacessível) e configure no recurso (403 visível sem ação). Autorizar antes de adquirir FOR UPDATE; reconsultar capacidades após adquirir o lock e antes de alterar. Manter mesma transação para atualização e auditoria.
- [x] INSERT/UPDATE de devices valida novo gateway_id no mesmo building, inclusive por SQL direto. UPDATE não pode mover ID/building_id. Restringir grants UPDATE de devices aos campos de configuração das rotas e updated_at; gateways aos campos de configuração/metadata/updated_at. Status/last_seen_at continuam escritos pelo processo proprietário de ingestão. No endpoint de credenciais, remover a atribuição redundante de status atual.
- [x] POST /devices/:id/metrics exige leitura + configure no dispositivo e força building_id/device_id do recurso autorizado; INSERT direto mantém a mesma relação. Criar auditoria DEVICE_METRIC_CREATED com identidade/métrica/tenant corretos na mesma transação.
- [x] POST /gateways/:id/credentials exige leitura + configure no gateway, inclusive para plataforma. Autorizar, bloquear linha e revalidar após espera. Retornar senha aleatória somente na resposta de emissão, guardar somente hash e preservar DTO/tópicos MQTT. PATCH metadata não pode alterar credenciais; listagens/criação/edição nunca devolvem hash ou username privado. Não incluir senha/hash na auditoria ou logs.
- [x] Atualizar CASE da policy INSERT de audit_logs preservando branches 016/018 e ações legadas restantes. DEVICE_CREATED/GATEWAY_CREATED exigem capacidades inteiras; DEVICE_UPDATED/GATEWAY_UPDATED/GATEWAY_CREDENTIALS_ISSUED exigem leitura/configuração no recurso correto; DEVICE_METRIC_CREATED exige leitura/configuração do dispositivo real da métrica. actor_type USER/user_id atual e tenant/resource_id corretos, sem fallback legado nessas ações.
- [x] Testar audit failure/rollback explícito desfaz alteração ou emissão; revogação durante espera de lock impede a mudança; leitura/configuração independentes, DML não autorizado e app.role forjado negados. Erros de relação/duplicação são genéricos, sem nome/metadata de outro condomínio.

## Tarefa 4 — acesso vigente e preservação

- [x] Mesmo JWT perde leitura/alteração após revogar binding/equipe/suporte/papel global de suporte; expiração e tenant/organização/conta inativos negam acesso. Plataforma com concessão local real pode operar somente no recurso concedido.
- [x] Leituras de métricas inconsistentes do owner e devices com gateway estrangeiro são ocultas. Tentativas de inserir/associar gateway de outro tenant falham em HTTP e SQL restrito.
- [x] Credencial emitida autentica somente seu gateway, senha anterior deixa de autenticar após rotação; broker continua recusando publicação estrangeira, comando e subscribe de gateway. Suporte/read-only não emite nem modifica credenciais.
- [x] Fixture MQTT positiva recebe concessão local explícita; não restaurar bypass global. Testes de telemetria/alertas e pausa continuam usando suas projeções mínimas independentes de configuração.

```powershell
pnpm --filter @predioon/api exec node --import tsx --test --test-concurrency=1 test/equipment-capabilities.test.ts test/mqtt.test.ts test/runtime-credentials.test.ts test/telemetry-capabilities.test.ts test/alert-capabilities.test.ts test/feature-enforcement.test.ts
pnpm --filter @predioon/api typecheck
pnpm check:boundaries
git diff --check
```

Usar quatro DSNs do banco isolado e RUN_ACCESS_DB_TESTS=1/RUN_RBAC_DB_TESTS=1. Cleanup em finally; preservar registros de outros testes. Logs distintos em .local, criado se ausente.

## Tarefa 5 — aceite

- [x] Corrigir a compatibilidade de leitura de disponibilidade de portões: morador não possui devices:read, mas sua abertura autorizada não pode falhar por consultar inventário privado. Criar app_access_hardware_state(building text,gate uuid), SECDEF STABLE, owner administrativo, search_path public,pg_temp, EXECUTE somente app. Retornar exatamente enabled/status/last_seen do gateway e dispositivo (seis campos), sem IDs, configuração ou credenciais. Validar gate PK/tenant, recursos reais do mesmo tenant e relação device.gateway_id=gate.gateway_id; conta/org/tenant ativos e regra física legada atual por fatos reais de usuário/membership e janela, ignorando app.role. Global legado permanece apenas para esta compatibilidade de disponibilidade; não recebe inventário privado. Usar nos caminhos de listagem/abertura de gate existente; cadastro/edição de gate preservam SELECT privado autorizado. Manter pausa/locks/throttle/idempotência e ausência de replay. Testar residente sem SELECT privado ainda abre gate permitido; outsider/papel forjado/revogação/pertencimento errado não consultam projeção.
- [x] Substituir somente a policy gate_commands_request dentro de 020: seu JOIN antigo a devices/gateways aplica RLS privada também durante INSERT residencial. Consultar a projeção mínima vinculada ao gate, mantendo checks atuais de requested_by/status/created_at/sent_at/acknowledged_at/failure_reason, gate e referências exatas, enabled/allowResidents/app_access_role, hardware habilitado/online/recente e constraint de TTL. Demais policies/grants/trigger de acessos e dispatcher permanecem iguais. Reproduzir a falha de abertura sem permissão de inventário antes da mudança.
- [x] Fixtures positivas de configuração recebem concessão local: access.integration concede ao administrador seeded somente device e gateway próprios, com cleanup; features-lifecycle concede somente o condomínio exclusivo da fixture, com cleanup. Não conceder inventário técnico ao morador. O caso 17 de descoberta mantém negação da concessão building e todas as negativas de capacidades inteiras/escritas; concessão device agora retorna 200 com somente o dispositivo concedido. Registrar a regressão integral que motivou os ajustes e refazer ambas as revisões sobre a fonte expandida.

- [x] Revisão de conformidade, correções e nova revisão.
- [x] Revisão de qualidade após conformidade aprovada, correções e nova revisão.
- [x] Agente principal executa regressão integral com fonte estável e banco livre, atualiza docs/AUTORIZACAO.md e tracker, faz commit/push na branch existente.
- [x] Registrar SSE de equipamento/gateway e consumers web de permissões como entregas dependentes; nenhum contador global sujeito à RLS deve ser declarado saúde operacional global.

Estado: concluído e aprovado nas duas revisões sobre o escopo ampliado. Dirigido 117/117, nove suites; regressão integral do agente principal 288/288, 32 suites, sem skips/cancelamentos. Tipos da API, fronteiras e diff-check passaram; 020 reaplicada atomicamente e fixtures limpas. A execução integral anterior encontrou 272 aprovados, uma expectativa antiga de escopo e 11 cancelamentos por dois setups; a investigação corrigiu as fixtures e a dependência real da abertura residencial em SELECT privado. A adaptação de classificação usa concessão somente de telemetria para preservar a prova de independência de configuração. O problema de vigência em transação bloqueada foi reproduzido e segue no corretivo 021 separado. SSE de status e funcionalidades está detalhado em 022. Não encerra 2B.3 nem cria aplicativos ou backend separado.
