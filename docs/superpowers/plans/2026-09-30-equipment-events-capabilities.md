# Eventos de equipamentos e funcionalidades por capacidade — 022

> **For agentic workers:** usar subagent-driven-development, TDD e revisão de conformidade seguida de qualidade. Agente principal integra documentação/Git. Não iniciar antes do aceite de 020/021.

**Goal:** completar a autorização dos kinds atuais do SSE central: device-status, gateway-status e features-changed. Não inferir leitura técnica por papel legado ou descoberta básica do condomínio.

**Architecture:** cada evento revalida identidade e capacidades atuais dentro da transação que conserva o lock compartilhado de funcionalidades até a entrega. Consultar o recurso persistido por PK e reconstruir somente campos públicos do envelope. Projeção mínima de classificação e policies de leitura de funcionalidades impedem dependência em permissões de outro domínio.

**Tech Stack:** Express, SSE, PostgreSQL NOTIFY e bibliotecas existentes; sem broker/cliente/backend novo.

## Dependências e arquivos

Reutilizar helpers 020 de equipamento e relógio corrigido por 021. Aplicar/reaplicar somente nova 022 atomicamente no banco isolado localhost:5436; não usar produção, seed, push de schema ou migrations antigas.

- Criar `infrastructure/022-equipment-events-capabilities.sql`.
- Criar `apps/api/src/modules/events/equipment.ts` e `features.ts` para projeções.
- Modificar `apps/api/src/modules/events/routes.ts` na entrega dos três kinds restantes.
- Criar `apps/api/test/equipment-events-capabilities.test.ts`.
- Não alterar contratos/DTOs, bus, branches de telemetria/alertas nem handlers de configuração/credenciais/atuação física.

## Tarefa 1 — RED e autorização vigente

- [ ] Testes reais HTTP/SSE + NOTIFY com fixtures exclusivas: pessoa/equipe sem membership legado, whole tenant, dispositivo específico, gateway específico, suporte temporário devices:read em cada tipo, vínculos legados válidos, morador, administrador global sem concessão local e flag global sem concessão local.
- [ ] Dispositivo não herda gateway, gateway não herda dispositivo; autorização em alerta/telemetria ou só buildings:read não libera status técnico. Concessões repetidas/mistas não duplicam entrega.
- [ ] Mesmo stream/JWT perde próxima entrega por revogação de pessoa/equipe/suporte/papel de suporte, expiração, equipe/organização/condomínio inativos. Conta/sessão revogadas encerram stream; preservar expiry timer/heartbeat existentes. Remover bindings/catalog temporários em finally.
- [ ] Payload NOTIFY com status/config/metadata/hash falsificados: resposta usa status persistido e contém exatamente quatro campos (kind/buildingId/deviceId ou gatewayId/status). Recurso inexistente, estrangeiro, inconsistente ou ID estranho é ignorado e conexão continua. IDs textuais, sem cast UUID.

## Tarefa 2 — projeção mínima e pausa independente

- [ ] device-status exige devices:read no dispositivo via 020, consulta a linha persistida sujeita à RLS e confirma building/id. gateway-status equivalente para gateway. Mapear status do banco, nunca confiar no status recebido como autorização ou conteúdo.
- [ ] Criar helper SECDEF STABLE pontual de classificação de dispositivo autorizado, owner administrativo e search_path public,pg_temp, EXECUTE somente app. Retornar somente device_type, gate_kind e parking_vehicle_type; gate/parking associados validam o mesmo tenant. Não retornar configuração/metadata nem percorrer histórico de telemetria/alertas. Autorização por app_device_has_capability; ID/bld vindos do lookup persistido.
- [ ] device-status mantém a semântica atual ANY feature habilitada de deviceFeatures/gateFeature/parkingFeature, baseada na classificação segura; pausado não entrega. Retomada volta a permitir status atual, sem criar requisito de frescor inexistente no contrato de status. gateway-status não é ocultado por pausa de funcionalidade específica.
- [ ] Policies SELECT adicionais de building_feature_settings/feature_runtime usam app_equipment_can_read_scope para dispositivo/gateway e não liberam escrita. Usuário somente devices:read conserva leitura do estado local mesmo após retirar buildings:read/telemetry/alerts do seu papel; não assumir defaults habilitados porque RLS ocultou settings.
- [ ] Testar esse cenário com capacidades de outros domínios retiradas/restauradas: paused water/gate/parking e mistura de funcionalidades; equipamento desativado continua visível para diagnóstico quando sua funcionalidade permite. Concessão de recurso inexistente/estrangeiro não revela estado local por este helper.
- [ ] Testes de ownership/search_path/STABLE/grants e EXPLAIN pontual/estado sem histórico; os privilégios de dados do runtime e a projeção residencial de hardware de 020 não mudam.

## Tarefa 3 — mudança de funcionalidades

- [ ] features-changed global com buildingId '*' permanece marcador de invalidação para qualquer sessão central válida; reconstruir exatamente kind/buildingId, sem campos recebidos extras.
- [ ] features-changed local exige condomínio real e leitura atual de seu estado: descoberta básica 019, capacidade operacional de telemetria 017, alertas 018, equipamento 020/022 ou features:manage global. Usar helper boolean owner controlado, sem ler configurações privadas ou promover concessão local a domínio inteiro. Plataforma com features:manage pode receber marcador local; isso não libera status ou conteúdo privado.
- [ ] Provar leitura local operacional sem buildings:read e negar marker local a outsider/global sem capacidade apropriada, recurso desaparecido/estrangeiro, vínculo revogado/expirado. Envelope entregue tem exatamente dois campos.
- [ ] Rotas SSE removem buildingRole e sensorFeatureKeys dos três kinds restantes; cada branch explicitamente projeta ou ignora. Manter identidade revalidada por mensagem, fila serial limite100, lock até res.write, cleanup, timers e branches de telemetry/alert intactas. Kind futuro desconhecido nunca cai em entrega permissiva.

## Tarefa 4 — verificações e aceite

- [ ] Testes SSE têm limite de tempo, marcador global para delimitar lote negativo, encerram reader/abort/timers e limpam fixtures em finally. Não adicionar retries para esconder falha de conexão/asserção.
- [ ] Dirigido: novo teste, equipment-capabilities, telemetry-events-capabilities, alert-events-capabilities, sessions, feature-enforcement e authorization-time-windows; conferir nomes exatos com rg --files. Concorrência de arquivo1, quatro DSNs e ambas flags de integração.
- [ ] API tipos, fronteiras, diff-check, apply/reapply e cleanup do banco registrados em .local. Não expor segredos em saída.
- [ ] Conformidade, correções/revisão; depois qualidade, correções/revisão; agente principal API integral na fonte estável e banco livre, docs/tracker e commit/push.

Estado: planejado, dependente de equipamentos 020 e vigência 021. Monitoramento/dashboards, comunicação/atendimento, configuração/atuação e administração continuam na sequência de domínios; gestão web, identidade, workers duráveis, aplicativos e implantação permanecem no tracker total.
