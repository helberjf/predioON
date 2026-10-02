# Estacionamento por capacidades — 033

Plano aprovado pelo agente principal em 02/10/2026, com SQL 033 reservado. Executar RED antes de produção e aguardar encerramento da janela de navegador dos demais agentes. A sequência aprovada de 2B.3 coloca estacionamento entre configuração e atuação; 032 concluiu regras de alerta. Auditoria, usuários, organizações e suporte seguem legados separados.

## Evidência anterior à implementação

- `apps/api/src/modules/parking/routes.ts` ainda decide leitura por `assertBuildingAccess` e escrita por `requireRole(BUILDING_ADMIN)`/membership. Pessoas e equipes com capacidades atuais não substituem esse caminho.
- SQL009 mantém `parking_read_policy` com `app_can_access_building` e policy permissiva ALL com `app_is_building_admin`. O app recebeu DELETE, embora não exista endpoint DELETE.
- `verifySensor` consulta inventário inteiro sob RLS; um gestor somente do novo domínio teria negação falsa sem `devices:read`. O trigger INVOKER `validate_parking_sensor_scope` também consulta devices e repetiria essa dependência no SQL direto.
- PATCH bloqueia o estacionamento antes de conferir o sensor. Ingestão bloqueia o dispositivo antes de atualizar contagem; a configuração deve seguir essa mesma ordem e revalidar versão e autoridade depois da espera. O índice UNIQUE por sensor pode promover o bloqueio da linha durante UPDATE. O deadlock reproduzido em032 motivou esta análise, mas não é evidência de um deadlock já reproduzido em estacionamento.
- Configuração usa versão otimista; mudar sensor limpa observação/source e não pode preservar leitura do sensor anterior. Pausa/retomada limpa observações via função de funcionalidades. Cálculos `parkingAvailability` e `acceptParkingReading` já distinguem unknown/stale/current; não devem ser reescritos.
- Datas de atualização manual/configuração usam relógio JS. Padronizar estes stamps para `clock_timestamp()` sem alterar o timestamp dos eventos recebidos nem a política de frescor da ingestão.

## Escopo aprovado

Adicionar `parking:read` aos quatro papéis locais e `parking:manage` somente BUILDING_ADMIN. Globais, flag e suporte não recebem estacionamento por inferência. Manter capabilities separadas de `devices:read/configure`, telemetria e comandos físicos; não ampliar whitelist diagnóstica de suporte.

Recurso concreto `parking` (nome já usado nas duas ações de auditoria), com autorização inteira, exata no estacionamento ou no sensor realmente vinculado. A relação sensor/gateway precisa existir no mesmo condomínio. Configuração sem sensor é geral: criação/retarget para NULL exige concessão inteira. Criar/retarget para sensor requer read/manage inteiros ou no dispositivo de destino. Uma concessão apenas no estacionamento não pode trocar o sensor para fora do seu escopo.

Preservar comportamento observável de hardware: leitura e contagem manual continuam possíveis quando o sensor/gateway estiver desativado. Criação/configuração com sensor exige sensor PARKING_SENSOR e gateway ativos como o handler atual, inclusive quando o sensor informado não mudou; flexibilizar isso seria uma decisão de produto adicional, não correção automática de RBAC.

Preservar paths, query buildingId obrigatória, DTO atual, ordenação SQL por vehicleType, limites, capacidade, versão, conflitos e freshness/resume. A leitura atual inclui sensorId e configuração; separar uma projeção residencial menor é outro recorte de contrato e não será introduzido implicitamente. HTTP passa a `no-store` e remove somente guards legados do módulo.

PATCH continua exigindo capacidade e versão, mas campos opcionais omitidos não recebem defaults de criação: preserva sensor e prazo já configurados. Schemas estritos recusam campos de identidade, estado e chaves desconhecidas. Criação mantém os defaults públicos existentes.

## TDD e segurança do banco

1. RED real: equipe/pessoa sem membership negada; flag global lê/escreve indevidamente; concessão de outro prédio não atravessa. Fixtures de carro/moto, lot sem sensor, sensor/gateway estrangeiro ou inconsistente, disabled e expirados. Catálogo novo pode ser inserido temporariamente apenas para satisfazer FK, com cleanup rastreado.
2. Helper pontual SECDEF STABLE por PK+tenant, UUID textual inválido false e pais verdadeiros; helper de escopo por bindings atuais, incluindo vazio autorizado sem varrer histórico. Janelas de 021, papéis/permissões/conta/tenant/equipe ativos, sem usar app.role como autoridade.
3. SELECT/INSERT/UPDATE específicos; retirar ALL e DELETE do app. INSERT valida destino autorizado e gera id no servidor. UPDATE limita colunas, preserva id/building/vehicleType, aplica guard de retarget no SQL direto e impede reaproveitar ocupação de sensor antigo. Trigger de pertencimento deve funcionar sob leitura somente de estacionamento, com owner/search_path/ACL restritos e sem devolver inventário.
4. Lock mínimo do sensor proposto ANTES da linha de estacionamento, após autorização inicial e com validação fresca após espera. Aplicar também quando sensorId informado coincide com a primeira leitura, pois outro writer pode alterar o pai. Sem retries. Teste real dispositivo bloqueado + ingestão atualizando estacionamento; observar pg_blocking_pids antes de liberar.
5. Guardas HTTP fresh após lock e feature shared lock; mudança de versão concorrente retorna409, capacidade abaixo da ocupação retorna400, troca de sensor limpa occupancy/source/observedAt. Auditoria atomicamente com alteração, somente ações PARKING_CONFIGURED/PARKING_OCCUPANCY_UPDATED da policy atual.
6. Settings/runtime e evento de funcionalidades acrescentam apenas caminho por capacidade do novo domínio, preservando todas as branches atuais via definições vigentes. Não copiar versões antigas do SQL.
7. Testes negativos SQL sem WHERE, INSERT/UPDATE de identidade/tenant e sensor externo, DELETE negado, auditoria forjada, UUID inválido, flags globais, suspensão de read independente de manage e de manage independente de read. Revogação/expiração durante espera tanto da origem quanto do sensor proposto; resposta sem mutação/audit.
8. Reaplicação dupla preserva permissões/vínculos inativos e catálogo/ACLs/policies alheias. Helper invocável somente pelo app quando necessário; particulares owner-only, identity/broker sem execute. EXPLAIN real por PK/candidatos, sem seqscan histórico nem alterações de planner para mascarar custo.

## Consumidores e verificação

No mesmo checkpoint ou entrega dependente, ParkingPanel deixa de inferir gestão de buildings:manage; checa capacidades inteiras/exatas por estacionamento/dispositivo sem inventário obrigatório. Morador mantém consulta de contagem/frescor. Testar pausa de CAR_PARKING versus MOTORCYCLE_PARKING, retomada sem leitura nova, edição de versão, troca de sensor, manual versus ingestão, erro/sem acesso distinto de zero.

Dirigidos: novos testes do domínio + access-parking, features/lifecycle, equipment/SSE, alert classification, notices que exibem vagas, RBAC/tenancy. Regressão integral somente após fonte congelada e autorização do agente principal. Endpoints de portão, MQTT, QoS, dispatcher e replay de comando físico ficam intocados neste recorte.

Arquivos previstos: SQL aditivo novo; parking/{routes,authorization}; teste API do domínio; shared catálogo+unit; adaptação de isolamento de features afetada. Implementar como `infrastructure/033-parking-capabilities.sql`; catálogo e escopo adicionam somente as capacidades `parking:read`, `parking:manage` e o recurso `parking`. Riscos reais restantes de outros domínios: auditoria ainda usa leitura legada e pode expor metadata privada por permissão ampla; suporte remoto continua exclusivo da flag de plataforma; usuários/vínculos e organizações continuam ordinais.

## Evidência do checkpoint backend — 02/10/2026

Implementados SQL 033, catálogo, helpers, handlers e 27 testes do domínio. Aplicação atômica em PostgreSQL/Timescale real, container isolado `predioon-test-backend`, porta 5437. API e SQL ficaram estáveis durante os testes dirigidos finais.

O RED anterior à implementação confirmou três problemas de comportamento: gestor RBAC sem membership recebia 403 na consulta, flag global recebia 200 e o runtime podia excluir estacionamento diretamente. A mudança separa leitura/gestão de estacionamento do inventário; concessões individuais, por equipe, exatas e por sensor real passam pelos mesmos predicados no HTTP e na RLS. O aplicativo perdeu DELETE e atualização das colunas de identidade. Ao trocar sensor, o trigger limpa contagem, origem e observação mesmo no SQL direto.

A revisão independente identificou uma corrida adicional de criação: o INSERT podia esperar a FK do sensor enquanto outra transação o desativava e ainda responder 201. O teste reproduziu esse RED antes da correção. O handler agora revalida gestão e sensor/gateway em statements novos após INSERT, antes da auditoria. Tanto o caso de sensor quanto o de gateway desativado durante essa espera passaram, sem registro persistido nem auditoria parcial.

Validação concluída:

- 155/155 testes em 11 suites, zero skips/falhas/cancelamentos, em 407 segundos: estacionamento, avisos/agenda, funcionalidades e lifecycle com ingestão, alertas, regras, equipamentos, RBAC unitário e RBAC real. Flags de banco ativas. O arquivo novo possui 27 casos, incluindo revogação/expiração durante locks, escopo vazio, entrega depois de revogação, rollback de auditoria e preservação de campos omitidos no PATCH.
- 5/5 testes adicionais do pipeline real de ingestão de estacionamento passaram: tipos de veículos independentes, rejeição de amostras inválidas/antigas/fora de ordem, precedência da contagem manual, hardware desativado e auditoria de sensor. MQTT/publicação e comandos físicos não foram alterados.
- A concorrência observada com `pg_blocking_pids` confirmou espera no sensor antes da linha de estacionamento; uma contagem concorrente foi preservada e a configuração retornou 409 por versão antiga. Nenhum retry foi introduzido. Isso verifica a ordem e a versão, sem afirmar um deadlock de estacionamento que não foi reproduzido.
- Reaplicação dupla preservou permissões/vínculos inativos, todas as branches alheias de auditoria/eventos, policies de outros domínios e validadores de recursos anteriores. Helpers privados ficaram sem EXECUTE para app/identity/broker; helpers públicos do domínio ficaram somente para app, com owner/search_path restritos. EXPLAIN do SQL persistido usou a PK de estacionamento e candidatos de vínculos para escopo, sem forçar planner.
- Tipos API/shared, fronteiras arquiteturais e diff-check passaram. Cleanup confirmado: zero organizações, usuários e papéis das fixtures de estacionamento. Duas revisões independentes não encontraram outro bloqueador após o ajuste de criação.

Próximos passos de integração: commit/push pelo agente principal, aplicação nos bancos de integração e ledger, regressão integral API/DB, depois adaptação do ParkingPanel e testes reais de navegador. `e2e/parking.spec.ts` está preparado para o RED da interface, mas ainda não foi executado nem integra este checkpoint backend. A interface continua sendo uma entrega dependente; este registro não afirma que estacionamento ou o projeto completo estejam encerrados.
