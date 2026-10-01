# Dashboards por escopo e resumo da plataforma — 024

> **For agentic workers:** usar subagent-driven-development e TDD; revisão de conformidade antes de qualidade. Integrar após o aceite e publicação de 023. O agente principal mantém documentação/Git.

**Goal:** remover dependências legadas de `/overview/building` e `/overview/platform` e corrigir os consumidores que interpretam ausência de acesso como ausência de equipamento ou alerta.

**Architecture:** o dashboard local compõe leituras já autorizadas pelos respectivos domínios. A plataforma recebe uma projeção agregada específica, sem acesso automático ao inventário privado, mensagens de alertas ou leituras. As consultas de autorização usam a vigência de 021.

**Tech Stack:** Express, PostgreSQL, contratos TypeScript e painéis React/Vite existentes. Sem nova biblioteca ou serviço.

## Arquivos

- Criar `infrastructure/024-overview-capabilities.sql` e `apps/api/src/modules/overview/authorization.ts` para a projeção/consultas autorizadas; modificar `apps/api/src/modules/overview/routes.ts`.
- Criar `apps/api/test/overview-capabilities.test.ts` e ampliar somente as asserções de catálogo necessárias em `apps/api/test/rbac-tenancy-unit.test.ts`.
- Modificar `packages/shared/src/rbac.ts`; criar `packages/contracts/src/overview.ts` e exportar em `packages/contracts/src/index.ts`.
- Modificar `packages/ui/src/types.ts` para usar os DTOs portáteis; manter a exportação atual. Criar `packages/ui/src/overview-state.ts` e `packages/ui/test/overview-state.test.ts` para decisões de disponibilidade/cobertura, sem dependência de servidor.
- Modificar `apps/admin-web/src/pages/Overview.tsx` e `apps/building-web/src/pages/Dashboard.tsx`; não alterar navegação, outros domínios ou identidade neste recorte.

## Decisões

Criar `platform:read-health` no catálogo e no conjunto global de PLATFORM_ADMIN. Esta capacidade permite contadores e distribuição agregada de status dos condomínios ativos; não entra nas capacidades locais nem no conjunto de suporte temporário. `buildings:read` global continua responsável pelos nomes/códigos do diretório: sem ela, o resumo pode retornar totais agregados, mas não a lista identificada de condomínios. Explicitar a indisponibilidade do diretório no DTO e no painel; não exibir ausência de condomínios ou convite para cadastrar como consequência de perder a leitura. A compatibilidade da flag administrativa segue limitada às capacidades globais enquanto sua migração final estiver pendente.

O resumo da plataforma não devolve IDs de dispositivos/gateways/alertas, mensagens, valores de sensores, configuração, metadata ou credenciais. A interface deve usar sua distribuição agregada para os quadros por categoria e condomínio. Conteúdo privado detalhado continua exigindo concessão local; retirar a leitura técnica local não pode transformar alertas existentes em zero no resumo global.

No resumo local, cada domínio informa cobertura `whole`, `partial` ou `none`. Contadores sem leitura têm valor null; zero significa um conjunto autorizado realmente vazio. Uma concessão de dispositivo não revela contadores de gateways nem de outro dispositivo. A cobertura parcial nunca representa a situação completa do condomínio. Dados antigos ou inexistentes, pausa e falha de consulta não autorizam a mensagem “Tudo em dia”.

Ocorrências ainda não migradas não serão lidas por um novo bypass compartilhado. Neste recorte, seu contador fica indisponível e o painel mantém acesso ao módulo existente. Depois de migrar comunicação/atendimento, um recorte de integração restaurará o contador pela autorização própria, distinguindo chamados próprios de cobertura administrativa completa. Contadores de equipamento representam o inventário/status persistido, preservando a independência de pausa de 020; não equivalem a uma leitura recente do sensor.

## Tarefa 1 — RED e contratos

- [ ] Testar resumo local para concessões individuais, equipe, recurso exato, alert-only support, telemetry-only support, morador, plataforma e flag sem concessão local. Cobertura e null/zero precisam distinguir leitura ausente, parcial e conjunto vazio.
- [ ] Testar resumo global sem concessão local, com retirada independente de `platform:read-health` e `buildings:read`, conta/papel/permission revogados/inativos/expirados, contexto app.role forjado e bindings locais que tentem conceder capacidade global.
- [ ] Acrescentar DTOs portáteis em contracts para os dois resumos e reexportar os consumidores web. Preservar campos de rotas existentes onde possuem o mesmo significado; explicitar contadores nullable e cobertura por domínio.
- [ ] Testes negativos procuram campos privados no envelope e confirmam que os endpoints de inventário, alertas e telemetria continuam negados ao ator global sem concessão local.

## Tarefa 2 — SQL e API

- [ ] Criar somente migration 024 aditiva. Acrescentar a permissão e o vínculo de catálogo; estender somente a whitelist global atual de 021, preservando relógio, owner, ACL, signatures e demais decisões. Não reaplicar helpers antigos.
- [ ] Projeção SECDEF STABLE global, owner administrativo, search_path public,pg_temp, EXECUTE somente app. Autorizar antes de consultar. Agregar gateways/dispositivos/alertas separadamente por condomínio real, sem produto cartesiano de JOINs nem materializar mensagens/histórico para contar. Validar relações reais de equipamento e contexto de alerta; organizações/condomínios inativos não contribuem.
- [ ] Retornar totais agregados de organizações/condomínios/usuários ativos/equipamentos/alertas e distribuição por categoria. O contador de usuários não expõe identidades ou cadastros. A lista identificada exige também diretório global. Não conceder SELECT bruto adicional nem criar uma policy global em tabelas privadas.
- [ ] `/overview/platform` usa capacidade global vigente, sem requireRole/app_support_admin. Remover fetch de alertas privados e filterSensorRows do resumo global.
- [ ] `/overview/building` aceita descoberta básica ou escopo operacional válido em condomínio ativo. Calcular cobertura atual de dispositivos/gateways/alertas independentemente; consultas de conteúdo continuam sujeitas às RLS de 018/020 e projeções mínimas autorizadas.
- [ ] Alertas locais usam authorizedAlertContexts/alertFeatureKeys e readFeatures sob o lock existente, sem buscar configuração de devices/rules. Limitar a lista recente depois do filtro correto e conservar os campos existentes. Estado de funcionalidades precisa permanecer visível ao leitor independente do domínio.
- [ ] Revalidar escopo e recursos após consultas separadas antes de entregar dados em memória. Revogação/expiração entre consultas não pode produzir um resumo privado ou defaults de pausa indevidos.
- [ ] Provar owner/ACL e catálogo/grants fora do recorte intactos; EXPLAIN real para as agregações, com fixture de múltiplos gateways/dispositivos/alertas no mesmo condomínio para detectar contagem multiplicada. Não forçar opções do planner.

## Tarefa 3 — painéis web

- [ ] Admin Overview usa dados agregados da nova resposta para distribuição, quadros e contadores. Remover chamadas privadas globais usadas como substituto do resumo; detalhes com conteúdo privado ficam condicionados a autorização local e a estado explicitamente informado pela API.
- [ ] Building Dashboard mostra “—” e uma mensagem simples quando o domínio não está disponível; mostra cobertura parcial com texto adequado. Não usar `Number(null)` ou `?? 0` para decidir ausência de alertas, conectividade ou saúde.
- [ ] A mensagem positiva exige cobertura completa dos domínios usados na conclusão e leituras recentes válidas; pausa, ausência de leituras e erro continuam estados neutros/indisponíveis. Contador de ocorrência indisponível vira “Acompanhar ocorrências”.
- [ ] Testar decisões de apresentação pelos estados da resposta. Verificar telas em navegador local para erro, vazio autorizado, leitura parcial e resumo global sem inventário privado; manter layout e rotas existentes.

Exemplos de asserções de comportamento, sem substituir as fixtures reais:

```ts
assert.equal(local.counts.gateways, null); // concessão somente no dispositivo
assert.equal(local.coverage.devices, "partial");
assert.equal(global.counts.open_alerts, "2"); // sem concessão local: agregado permitido
assert.equal((await privateAlerts(platformActor, buildingA)).status, 403); // consulta com tenant explícito
```

Registrar RED com `pnpm --filter @predioon/api exec node --import tsx --test --test-concurrency=1 test/overview-capabilities.test.ts` e com `pnpm --filter @predioon/ui test` antes da implementação. Valores agregados seguem a serialização pública definida no DTO; não afrouxar a comparação para esconder diferenças de tipo.

## Tarefa 4 — integração

- [ ] Aplicar/reaplicar somente 024 atomicamente no banco isolado preservado. Dirigido de overview, RBAC/modelo, buildings/features, autorização de vigência, equipment, alerts e feature-enforcement com ambas flags e concorrência1; limpar fixtures/locks e comparar catálogo.
- [ ] Tipos de todos os consumidores afetados, fronteiras, UI tests e builds dos dois painéis; conformidade e depois qualidade. Agente principal API integral em fonte estável e banco livre, documentação e commit/push autorizado.

Estado: planejado após inspeção de overview/routes.ts, ambos os painéis e DTOs. Não implementado nem validado. Depende de 023; não encerra 2B.3, a migração de ocorrências ou o plano total.
