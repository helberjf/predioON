# Ingest Runtime Credentials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retirar owner de todo o processo produtivo de ingestão/acesso, com duas conexões restritas verificadas e sem alterar a política MQTT, a atomidade038 ou as decisões048.

**Architecture:** `@predioon/db/ingest` atende observação e `@predioon/db/access-service` atende dispatcher/ACK. As cargas continuam no mesmo processo e na mesma sessão MQTT; helpers PostgreSQL controlam operações privadas e reusam a autorização física034. Uma migration integral, provisionamento atômico, ambiente dedicado, testes de conexões reais e restore entregam a transição completa.

**Tech Stack:** TypeScript ESM, Node24, pnpm10, postgres.js, Drizzle ORM, PostgreSQL16/TimescaleDB, MQTT.js, node:test, Docker Compose e GitHub Actions.

---

**Estado do documento:** plano; comandos/testes abaixo ainda serão executados. Não contém implementação verificada nem autorização de deployment real.

**Spec:** [2026-10-13-ingest-runtime-credentials-design.md](../specs/2026-10-13-ingest-runtime-credentials-design.md). **Base funcional examinada:** `codex/continue-product-plan`, commit `f83e3c645e13681bf3825b9b5f767a4b348c3304`. O HEAD avançou para `466881cdd3ec5718efdffeffb847d991dff61920` somente com documentação. O fetch de 13/10 encontrou `origin/main=6989248e2e6f5d63a9855939de643f458096abcc`, SQL001–051. `052-ingest-runtime-roles.sql` é nome proposto até a nova conferência do remoto.

**Ownership:** o executor raiz é responsável por Git, migrations, credenciais, CI, fontes e documentos de progresso. Este plano e seu spec podem ser preparados por um agente de planejamento; isso não lhe dá permissão de mutar banco ou fontes. Não compartilhar alterações cluster-wide de roles com testes/API/navegador. Trabalhar no worktree já existente; não criar outro checkout para este recorte.

## Mapa de arquivos e limites

| Arquivo/unidade | Responsabilidade |
|---|---|
| `packages/db/src/runtime-role-credentials.ts`, `runtime-connection.ts` | Seis roles, URLs estritas, construtor sem dotenv, verificador de backend real |
| `packages/db/src/transaction.ts`, `features.ts` | Tipo de transação neutro e features comuns, sem pool app/owner |
| `packages/db/src/ingest.ts`, `ingest-projections.ts`, `ingest-operations.ts` | Pool observacional, projeções sem metadata, adapters de SQL fechado |
| `packages/db/src/access-service.ts`, `access-service-operations.ts` | Pool físico e adapters de comandos/ACK |
| `packages/db/src/context.ts`, `identity.ts`, `broker-auth.ts`, `notifications.ts` | Compatibilidade explícita do carregamento de ambiente existente |
| `infrastructure/052-ingest-runtime-roles.sql` | Duas roles, ACL/RLS/defaults e todos os helpers das duas cargas, atomicamente |
| `packages/db/src/provision-runtime-roles.ts`, `infrastructure-migrations.ts` | Provisionar seis credenciais e proteger ledger das seis roles |
| `services/ingest/src/env.ts`, `config.ts`, `index.ts`, novo `startup.ts` | Ambiente dedicado e verificação anterior a MQTT/timers |
| `services/ingest/src/pipeline/*`, `offline-sweeper.ts`, `analytics/usage.ts`, `rules/evaluate.ts`, `notify/index.ts`, `parking/index.ts`, `realtime.ts`, `features.ts` | Migrar observação mantendo algoritmos/transações/provas |
| `services/ingest/src/access/dispatcher.ts`, `access/publish.ts` | Consumir helpers; erros de publicação com códigos fechados; invariantes físicas |
| `services/ingest/src/demo-data.ts`, simuladores/scripts | Owner somente CLI administrativo explícito; sem dependência reversa no runtime |
| `scripts/check-boundaries.mjs`, novo `scripts/runtime-import-graph.mjs` | Seguir grafo transitivo de arquivo, exports/aliases/relativos/dynamic imports |
| `scripts/write-ingest-runtime-env.mjs`, `scripts/start-local.ps1`, `scripts/test-start-local.ps1` | Produzir ambiente local de serviço como passo administrativo |
| `packages/db/test/*`, `services/ingest/test/*`, `packages/api-client/test/boundaries.test.ts` | Provas de login real, operações negadas, regressão, setup/restore/grafo |
| `infrastructure/docker-compose.prod.yml`, `setup-prod.sh`, exemplos públicos, `.github/workflows/ci.yml` | Somente credenciais da carga no container; CLI admin explícito; CI exclusivo |
| `docs/DEPLOY.md`, `docs/MIGRATIONS.md`, `docs/NOTIFICACOES_DURAVEIS.md`, `README.md`, progresso/evidência | Contratos de operação, comandos e resultados reais depois da verificação |

Não editar SQL001–051 ou seus checksums. Não alterar contratos/clientes/apps móveis, grants humanos, configuração de hardware ou decisões da inbox. Não conceder tabelas de outbox/worker à ingestão para resolver um erro de permissão. Acesso físico não usa `withUserContext`.

## Task 0: Conferir base e estabelecer ensaio exclusivo

**Files:** ler `.git`, `infrastructure/*`, `docs/INBOX_DECISOES.md`, spec acima; notas locais sob `.local/ingest-runtime/`. Não tocar em `.env` existente nem divulgar valores de conexão.

- [ ] Conferir worktree, branch, status e remoto antes de nomear migration:

```powershell
git status --short
git branch --show-current
git rev-parse HEAD
git fetch origin
git log -1 --format="%H %s" origin/main
git ls-tree -r --name-only origin/main infrastructure
```

Esperado após o fechamento documental: branch `codex/continue-product-plan`, HEAD 466881c (fonte funcional f83e3c6), remoto 6989248 e último SQL051. Se remoto tiver SQL052, integrar a mudança e escolher o próximo número livre, atualizando ambos documentos antes de codificar. Não reservar/aplicar número sem a conferência.

- [ ] Preservar a diferença de contrato existente: telemetria/consumo descartam building inativo; gateway-status/offline continuam acompanhando fonte habilitada nesse building. Incluir teste de ambos os comportamentos. Policies e produtor comum não acrescentam exigência de building ativo aos efeitos de comunicação.
- [ ] Preparar, sob controle administrativo, cluster físico descartável próprio de PostgreSQL16/Timescale, sem reutilizar database/roles de API, navegador ou outro projeto. Declarar em ambiente de teste `TEST_INGEST_DATABASE_URL`, `TEST_INGEST_DISPOSABLE_DB=1` e `TEST_INGEST_CONTAINER`; nenhum deles é consumido pelo runtime produtivo.
- [ ] Validar que o container e a conexão SQL identificam o mesmo `system_identifier` por `pg_control_system()` como administrador, seguindo o padrão de `backup-restore.test.ts`. Não imprimir URL, senha ou rolpassword. Registrar catálogo sanitizado inicial de roles, memberships, owners, ACL/defaults, policies, ledger e flags de RLS.
- [ ] Executar e registrar regressão dirigida da fonte anterior no cluster separado. RED posterior deve ser uma falta de contrato novo e não falha de conexão/fixture/SQL existente. Quando a suite exige flags, exigir zero skips na execução dedicada.

## Task 1: Preparo compatível do construtor e loaders existentes

**Files:** Modify `packages/db/src/runtime-connection.ts`, `context.ts`, `identity.ts`, `broker-auth.ts`; Create `packages/db/test/runtime-env.test.ts`. Ler `notifications.ts`/`env.ts`, sem mudar suas regras de carregamento.

**Meta publicável independente:** somente separar responsabilidade de carregamento. Não adicionar runtimeRoles, credenciais, migrations, ACLs, configurações de ingestão ou novos pools nesta tarefa. A ingestão continua owner, e o progresso registra esse preparo sem encerrar 2B.5.

- [ ] Escrever teste em subprocesso fresco para cada módulo, com `node:test` ESM module mocks. Mockar `dotenv.config` para contar chamadas e impedir leitura do arquivo real, `postgres` para contar construções sem abrir conexão e `drizzle-orm/postgres-js` para evitar qualquer acesso do adapter ao cliente falso. Injetar as quatro variáveis já existentes em env de fixture gerada em memória, sem logs de valores. Fragmento executado pelo subprocesso:

```js
import assert from 'node:assert/strict';
import { mock } from 'node:test';
let loads = 0, pools = 0;
mock.module('dotenv', { namedExports: { config: () => { loads++; return {}; } } });
mock.module('postgres', { defaultExport: () => { pools++; return { end: async () => {} }; } });
mock.module('drizzle-orm/postgres-js', { namedExports: { drizzle: () => ({}) } });
const cases = {
  'runtime-connection': { loads: 0, pools: 0 },
  context: { loads: 1, pools: 1 },
  identity: { loads: 1, pools: 1 },
  'broker-auth': { loads: 1, pools: 1 },
  notifications: { loads: 1, pools: 0 },
};
const target = process.env.TEST_ENV_ENTRYPOINT;
await import(process.env.TEST_ENV_ENTRYPOINT_URL);
assert.equal(loads, cases[target].loads);
assert.equal(pools, cases[target].pools);
```

O teste pai calcula `new URL('../src/'+target+'.ts', import.meta.url).href` e o passa como TEST_ENV_ENTRYPOINT_URL ao subprocesso; TEST_ENV_ENTRYPOINT é apenas o nome do caso. Invocar o filho com `--experimental-test-module-mocks --import tsx --input-type=module -e` e script acima, em cwd do package DB para resolver os mocks. Para cada entrypoint, verificar role/variável/max recebidos no mock do postgres, preservando os números 10/10/5 dos pools context/identity/broker; notifications continua factory sem pool no import. Verificar que erros de URL existentes continuam sanitizados.

- [ ] Executar RED, que hoje falha somente porque o import de runtime-connection chama dotenv:

```powershell
pnpm --filter @predioon/db exec node --experimental-test-module-mocks --import tsx --test test/runtime-env.test.ts
```

- [ ] Tirar exclusivamente `import "./env.js"` de runtime-connection. Adicionar `import "./env.js"` como primeira importação em context/identity/broker-auth; notifications já o possui. Não mudar runtimeDatabaseUrl, mapa de roles, verificador, flags, pools, config ou arquivos de ambiente. Não importar owner em nenhum entrypoint.
- [ ] Executar GREEN e regressão compatível:

```powershell
pnpm --filter @predioon/db exec node --experimental-test-module-mocks --import tsx --test test/runtime-env.test.ts test/runtime-provisioning.test.ts test/runtime-connection.test.ts
pnpm --filter @predioon/db typecheck
pnpm check:boundaries
```

Este teste de loading não precisa de banco; casos reais já existentes de runtime-connection só contam quando as flags/cluster correspondentes forem fornecidos. Registrar separadamente os skips desses casos. Revisar diff para confirmar somente os quatro arquivos fonte e teste novo, além de evidência/documentação da meta.

- [ ] Revisar, commitar e pushar este preparo compatível autorizado: `refactor(db): make runtime connection environment-neutral`. Atualizar progresso como **preparo publicado, ingestão ainda owner**. Esta publicação não é uma transição parcial de privilégios porque não altera role/config/runtime produtivo. Só depois avançar à release conjunta das Tasks2–12.

## Task 2: RED das credenciais, do ambiente e do grafo

**Files:** Modify `packages/db/test/runtime-connection.test.ts`, `runtime-provisioning.test.ts`, `runtime-env.test.ts`, `packages/api-client/test/boundaries.test.ts`; Create `services/ingest/test/startup.test.ts`.

- [ ] Estender testes de role/URL com os dois pares novos. Exemplo exato para URL obrigatória, sem imprimir seu valor:

```ts
for (const [variable, role] of [
  ["DATABASE_URL_INGEST", "predioon_ingest"],
  ["DATABASE_URL_ACCESS_SERVICE", "predioon_access_service"],
] as const) {
  it(`${variable} is mandatory in every environment`, () => {
    const saved = { url: process.env[variable], node: process.env.NODE_ENV };
    try {
      delete process.env[variable];
      for (const node of ["development", "test", "production"]) {
        process.env.NODE_ENV = node;
        assert.throws(() => runtimeDatabaseUrl(variable, role), new RegExp(variable));
      }
    } finally {
      if (saved.url === undefined) delete process.env[variable]; else process.env[variable] = saved.url;
      if (saved.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved.node;
    }
  });
}
```

Adicionar casos de role trocada/owner, URL com escapes inválidos, parâmetros de startup proibidos e causa do driver contendo sentinel. Asserção deve conferir o nome da variável e ausência do sentinel em erro/stdout/stderr. Para verificador real, adicionar novas roles ao loop de SET ROLE e SET SESSION AUTHORIZATION já existente; testar ambos sentidos de membership e propriedade de objeto.

- [ ] Acrescentar RED de boundaries às fixtures temporárias existentes:

```ts
it("follows the ingest adapter to a transitive owner import", async () => {
  await fixture({
    "services/ingest": { name: "@predioon/ingest", source: "import '@predioon/db/ingest';" },
    "packages/db": { name: "@predioon/db" },
  }, async root => {
    await writeFile(join(root, "packages/db/src/ingest.ts"), "export * from './unsafe.js';");
    await writeFile(join(root, "packages/db/src/unsafe.ts"), "import './index.js';");
    const errors = await checkBoundaries(root);
    assert.ok(errors.some(error => /Ingest owner boundary/.test(error)), errors.join("\n"));
  });
});
```

Criar manifest fixture com exports dedicados antes de validar resolução. Testar também `@predioon/db` direto, `/runtime`, caminhos relativos até index/context/env administrativo, reexport para outro workspace, `require`, dynamic literal, alias de tsconfig que termina no owner e dynamic calculado não resolvido. Comments/strings e schemas neutros passam. CLI demo-data isolado passa; se importado por `src/index.ts`, falha.

- [ ] Fazer startup.test usar dependências injetadas em `startIngestRuntime` (definidas na Task 3): qualquer verificação rejeitada deixa `connectIngest/startOfflineSweeper/startAccessDispatcher` com zero chamadas e fecha ambos pools. Testar guard em subprocesso com `DATABASE_URL` presente e fixture runtime file indevidamente contendo owner; stderr não contém sentinel e broker recebe zero conexões.
- [ ] Testar compatibilidade de env de context/identity/broker-auth/notifications em subprocessos com arquivo temporário dedicado de fixture, sem acessar `.env` do desenvolvedor. Testar que importar somente `runtime-connection` não invoca dotenv/constrói cliente e que os módulos humanos continuam recebendo suas variáveis pelo loader explícito.
- [ ] Executar RED:

```powershell
pnpm --filter @predioon/db exec node --import tsx --test --test-concurrency=1 test/runtime-provisioning.test.ts test/runtime-connection.test.ts test/runtime-env.test.ts
pnpm --filter @predioon/api-client exec node --import tsx --test test/boundaries.test.ts
pnpm --filter @predioon/ingest exec node --import tsx --test test/startup.test.ts
```

Esperado: pares novos não reconhecidos/exports inexistentes/owner graph aceito hoje. Casos existentes continuam verdes. Registrar RED e não aceitar todos os testes ignorados.

## Task 3: Entrypoints restritos, ambiente e startup

**Files:** Create `packages/db/src/{transaction,ingest,ingest-projections,access-service}.ts`, `scripts/runtime-import-graph.mjs`, `services/ingest/src/startup.ts`; Modify DB exports, runtime connection/credentials/features e loaders explícitos humanos, `services/ingest/src/{env,config,index}.ts`, `scripts/check-boundaries.mjs`.

- [ ] Acrescentar ao mapa fixo:

```ts
DATABASE_URL_INGEST: "predioon_ingest",
DATABASE_URL_ACCESS_SERVICE: "predioon_access_service",
```

`runtimeDatabaseUrl` exige variável explícita para notifications/ingest/access em todo ambiente. Preservar construtor puro e loaders explícitos publicados na Task1. Passar a checagem de memberships para `m.member=r.oid OR m.roleid=r.oid` nas duas novas roles e preservar os contratos atuais dos outros consumidores.

- [ ] Criar entrypoints simétricos, cada um com role e nome próprios. Conteúdo do pool observacional:

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { createRuntimeSqlClient } from "./runtime-connection.js";

export const ingestSqlClient = createRuntimeSqlClient("DATABASE_URL_INGEST", "predioon_ingest", 10);
export const ingestDb = drizzle(ingestSqlClient, { schema });
export type IngestTransaction = Parameters<Parameters<typeof ingestDb.transaction>[0]>[0];
export async function closeIngestDb(): Promise<void> { await ingestSqlClient.end({ timeout: 5 }); }
export { verifyRestrictedDatabaseRole } from "./runtime-connection.js";
export { lockFeatures, readFeatures } from "./features.js";
export { buildings, devices, gateways, ingestEvents, telemetry, alertRules, alerts } from "./schema.js";
export { monitoringProfiles, usageCursors, dailyUsage } from "./schema-monitoring.js";
export { parkingLots } from "./schema-parking.js";
export { gates } from "./schema-access.js";
export * from "./ingest-projections.js";
export * from "./ingest-operations.js";
```

O entrypoint físico constrói `accessServiceSqlClient/accessServiceDb` e exporta seus tipos, features e operations; não exporta tabelas humanas nem outros pools. `transaction.ts` usa `import type { PostgresJsDatabase }` e `import type * as schema` para derivar transação sem construir pool. `features.ts` recebe esse tipo neutro.

- [ ] Criar projeções explícitas da seção5 do spec. Para gateway:

```ts
export const ingestGatewayProjection = {
  id: gateways.id, buildingId: gateways.buildingId, name: gateways.name,
  serialNumber: gateways.serialNumber, model: gateways.model,
  firmwareVersion: gateways.firmwareVersion, protocolVersion: gateways.protocolVersion,
  status: gateways.status, enabled: gateways.enabled, lastSeenAt: gateways.lastSeenAt,
  createdAt: gateways.createdAt, updatedAt: gateways.updatedAt,
};
```

Criar device/building/rule projections com as colunas listadas no spec. Não usar `getTableColumns(gateways)` seguido de omit: uma coluna secreta futura precisa ficar invisível por default.

- [ ] `env.ts` usa somente `services/ingest/.env.runtime` quando presente, allowlist de duas URLs e chaves MQTT/offline/ALERT_WEBHOOK_URL já existentes; rejeita keys de outras conexões. Não lê `.env` central. `config.ts` exige/parsa os dois pares, compara host/porta/path sem owner e rejeita owner no process.env antes dos pools. `demo-data.ts` mantém loader administrativo próprio, para não herdar essa restrição como CLI.
- [ ] Fazer `index.ts` importar loader/config e depois importar dinamicamente `startup.ts`. O startup chama `verifyRestrictedDatabaseRole(ingestSqlClient,"predioon_ingest")` e o mesmo para access antes de `connectIngest`; falha fecha ambos pools e propaga erro sanitizado. Interface de teste:

```ts
export type StartupDependencies = {
  verifyIngest(): Promise<void>;
  verifyAccess(): Promise<void>;
  connect(): MqttClient;
  startOffline(): NodeJS.Timeout;
  startAccess(client: MqttClient): () => void;
  closeDatabases(): Promise<void>;
};
export async function startIngestRuntime(dependencies: StartupDependencies): Promise<() => Promise<void>> {
  try { await Promise.all([dependencies.verifyIngest(), dependencies.verifyAccess()]); }
  catch (error) { await dependencies.closeDatabases(); throw error; }
  const client = dependencies.connect();
  const offline = dependencies.startOffline();
  const stopAccess = dependencies.startAccess(client);
  return async () => {
    clearInterval(offline); stopAccess();
    await new Promise<void>(resolve => client.end(false, {}, resolve));
    await dependencies.closeDatabases();
  };
}
```

Vincular `connect()` ao roteamento atual de telemetry/status/ack; não mover MQTT.js, tópicos ou callback de PUBACK. Ajustar a assinatura do `client.end` à tipagem instalada sem mudar a semântica graceful do encerramento.

- [ ] Implementar grafo de arquivo iniciado em `services/ingest/src/index.ts` e nos dois exports de DB. Resolver exports de package.json, aliases/paths de tsconfig, extensão `.js`→`.ts`, relative/reexport/require/dynamic literal; ciclos têm visited set. Usar parser TypeScript já disponível no workspace através de createRequire do package DB, sem adicionar pacote. Import calculado atingido no grafo produtivo falha com arquivo/linha. Rejeitar index/context/env admin/seed/bootstrap/apply/provision/wait e outros pools; esquemas e tipo neutro passam. Manter regras existentes de API/notificações/clientes.
- [ ] Executar os comandos da Task2 e `pnpm check:boundaries`, `pnpm --filter @predioon/db typecheck`, `pnpm --filter @predioon/ingest typecheck`. Neste estágio, imports novos de operations podem ser adicionados junto às Tasks5–6 antes do typecheck final; não publicar um módulo com export irresolúvel. Commit local coerente somente após resolver os exports: `refactor(db): add explicit ingest and access runtime boundaries`.

## Task 4: Fixture real e RED de ACL/atomicidade 052

**Files:** Create `packages/db/test/fixtures/runtime-services.ts`, `packages/db/test/ingest-runtime.test.ts`, `packages/db/test/access-service.test.ts`; Modify `packages/db/test/infrastructure-migrations.test.ts`.

- [ ] Fixture compartilhada administrativa cria database UUID somente no cluster exclusivo da Task0, carrega baseline+chain, gera seis senhas aleatórias em memória e executa o provisioner como subprocesso com env explícito. Antes de qualquer alteração cluster-wide valida flag descartável, host local, container/system_identifier e catálogo inicial. Retorna `owner`, `ingest`, `access`, URLs restritas e cleanup; não retorna owner pelo entrypoint de runtime. Fecha todos clientes e remove somente database UUID que criou. Não logar senhas/DSNs/rolpassword.
- [ ] Definir `codeIs` e exigir login real positivo antes de negativos:

```ts
const codeIs = (code: string) => (error: unknown) => (error as { code?: string })?.code === code;
it("ingest cannot read gateway secrets or manufacture a human capability", async () => {
  await verifyRestrictedDatabaseRole(f.ingest, "predioon_ingest");
  await assert.rejects(f.ingest`select metadata from gateways`, codeIs("42501"));
  await assert.rejects(f.ingest.begin(async tx => {
    await tx`select set_config('app.user_id','fixture-platform-admin',true), set_config('app.role','PLATFORM_ADMIN',true)`;
    await tx`select password_hash from users`;
  }), codeIs("42501"));
});
```

Após erro SQL, uma transação fica abortada: usar uma negativa por begin, como acima. Não fazer várias negativas na mesma transação e confundir25P02 com42501. `f` é a fixture criada em before da suite, nunca um mock de driver.

- [ ] Positivos observacionais: safe inventory/features/row locks; inserir receipt/raw; heartbeat/status/firmware; profile lock sem UPDATE; usage upsert; regra global cooldown; alert+outbox; parking+audit; pg_notify. Negativas reais, uma operação por transação: metadata/hashes/users/sessions/reset/MFA/RBAC/comercial; hardware enabled/parent/name/type; profile tariff/limits/enabled; rule/feature/gate config; alterar/remover raw/receipt/audit/outbox; claim/complete worker; novo comando, SEND de acesso e DDL/create/temp/sequence/ledger.
- [ ] Positivos físicos: pending seleção concorrente, expiry, mark com autoridade corrente, failPending/failPublish/ACK e audit derivado. Negativas: users/secrets/human helpers/new request; table SELECT/INSERT/UPDATE/DELETE gate_commands; actor/identity/TTL/terminal; telemetria/alerts/usage/parking/outbox; phase/código/result inválidos; GUCs forjados não desbloqueiam privilégios.
- [ ] Catálogo: flags e ownership sem memberships em ambos sentidos, ACL tabela/coluna/função/default; testar PUBLIC grant antigo e grants de coluna contaminados antes da migration. Introduzir role nova dona de objeto em fixture isolada e exigir abort052 integral, sem remover o objeto ou transferir ownership.
- [ ] Testar falha no fim de052 e verificar de outra conexão que roles/ACL/helpers/ledger não ficaram parcialmente visíveis; reexecutar runner após sucesso retorna `[]`, passwords/login e dados permanecem. Conferir que001–051 não mudaram.
- [ ] Executar RED dedicado:

```powershell
pnpm --filter @predioon/db exec node --import tsx --test --test-concurrency=1 test/ingest-runtime.test.ts test/access-service.test.ts test/infrastructure-migrations.test.ts
```

Esperado antes de 052: ausência de duas roles/helpers ou falta de contrato no catálogo. Erro de segredo/dsn/config/cluster não conta como RED da feature. Não executar suites de alteração de roles em paralelo.

## Task 5: Migration observacional e adapters privados

**Files:** Create `infrastructure/052-ingest-runtime-roles.sql` após Task0, `packages/db/src/ingest-operations.ts`; Modify exports DB. Tests da Task 4 e novos casos em produtores/uso/parking.

- [ ] Abrir 052 com criação NOLOGIN de ambas roles e hardening integral. Seguir 038 para grants próprios: remover memberships nos dois sentidos, abortar ownership, revogar CREATE/TEMP e ACLs próprias de tabelas/sequences/functions/colunas. Inventariar PUBLIC sem broad revoke: instalação canônica 015 já revogou CREATE/TEMP de PUBLIC; testar privilégio efetivo via has_database_privilege e abortar 052 se recontaminado. Fazer o mesmo para PUBLIC em superfícies privadas/helper sensível, sem retirar acesso global de consumidores desconhecidos. Enumerar `pg_attribute.attacl` para revogar grants próprios de coluna; `REVOKE ALL TABLES` sozinho é insuficiente. Defaults de futuras funções owner/public são alterados de forma explícita e comparada em catálogo, mantendo ACLs atuais de funções e defaults destinados a consumidores antigos. Fixar owner/search_path/EXECUTE dos helpers novos.
- [ ] Criar guard interno completo; role esperada é argumento privado e não exportado ao runtime:

```sql
CREATE FUNCTION public.service_runtime_guard(expected_role name) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF expected_role NOT IN ('predioon_ingest','predioon_access_service') OR NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_stat_activity a JOIN pg_catalog.pg_roles r ON r.oid=a.usesysid
  WHERE a.pid=pg_catalog.pg_backend_pid() AND r.rolname=expected_role AND session_user=expected_role
   AND NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolinherit AND NOT r.rolcreatedb
   AND NOT r.rolcreaterole AND NOT r.rolreplication
   AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid OR m.roleid=r.oid)
   AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_shdepend d WHERE d.refclassid='pg_catalog.pg_authid'::regclass AND d.refobjid=r.oid AND d.deptype='o')
 ) THEN RAISE EXCEPTION 'Invalid service login' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.service_runtime_guard(name) FROM PUBLIC;
```

Alterar OWNER desse helper ao owner fixo antes dos GRANTs finais. Nenhuma role runtime recebe EXECUTE no guard; wrappers owner o chamam com constante.

- [ ] Aplicar a matriz do spec com GRANT de coluna e policies por role/operação. Exemplo executável de receipt, repetido estruturalmente para raw com os campos próprios:

```sql
GRANT SELECT,INSERT ON public.ingest_events TO predioon_ingest;
CREATE POLICY ingest_receipt_read ON public.ingest_events FOR SELECT TO predioon_ingest USING(true);
CREATE POLICY ingest_receipt_insert ON public.ingest_events FOR INSERT TO predioon_ingest WITH CHECK(
 source='MQTT' AND EXISTS(SELECT 1 FROM public.devices d JOIN public.buildings b ON b.id=d.building_id
  WHERE d.id=ingest_events.device_id AND d.building_id=ingest_events.building_id AND d.enabled AND b.active
   AND (d.gateway_id IS NULL OR EXISTS(SELECT 1 FROM public.gateways g
    WHERE g.id=d.gateway_id AND g.building_id=d.building_id AND g.enabled))));
```

Políticas legadas PUBLIC relevantes passam a `TO predioon_app` sem mudar expressões; políticas explícitas de identity/broker/notifications ficam. Projeções de hardware têm GRANT SELECT igual às colunas do objeto TS e UPDATE somente operacional. Uso permite INSERT/SELECT e UPDATE apenas payloads, com WITH CHECK de perfil/building. Alerts/parking/audit/outbox não recebem INSERT/UPDATE/DELETE direto. Não criar policy ALL de serviço abrangendo escrita de configuração.

- [ ] Implementar `ingest_count_rejection` com categorias fechadas, bucket e hora derivada; `ingest_lock_monitoring_profiles` com building/device associados ativos, perfil habilitado, ORDER BY id e `FOR UPDATE OF p`. Adapter retorna SELECT Drizzle normal por IDs bloqueados, sem conceder UPDATE a monitoring_profiles. Uma transação concorrente de administração deve aguardar esse lock, mesmo que a role de ingestão não possa mudar tarifa.
- [ ] Implementar assinaturas SQL exatas da seção6 do spec. `ingest_persist_alert` monta row esperado, força status/atores, valida source/rule, INSERT RETURNING + releitura + `notification_enqueue_alert` + fonte final. Usa `ingest_alert_outbox_signature` opaca baseada no snapshot ordenado das quatro tabelas; hash SHA256 de bytes JSONB, sem expor snapshot/claim token. Não conceder enqueue original, claim/complete ou tabela outbox.
- [ ] Implementar `ingest_lock_parking_lot(building_id,device_id)` SECURITY DEFINER com guard real, vínculo de sensor/condomínio e `FOR UPDATE OF lot`; retorna somente lot_id. Adapter `lockParkingLot(tx,buildingId,deviceId)` faz SELECT Drizzle normal sob o mesmo lock. Testar lock concorrente real sem UPDATE de qualquer coluna, inclusive negativa de UPDATE operacional/configuração direto. Implementar estacionamento por `ingest_write_parking_observation`: source persistido correspondente, sensor/lot/condomínio associados, expected_version, somente observação SENSOR e version+1; audit SYSTEM/user NULL derivado. Limpar/restaurar app.user_id no helper em sucesso/EXCEPTION para conservar trigger humano existente. Detectar skip/rewrite com RETURNING/releitura; não duplicar `acceptParkingReading`, uso, regras ou features em SQL.
- [ ] Adapters usam `tx.execute(sql\`select ...\`)`, convertem IDs/timestamps com nomes explícitos e rejeitam ausência de resposta esperada. O wrapper de persistência TS toma `expected` completo, mas só passa ao SQL os campos autorizados; actions humanas não são parâmetros. Exemplo do adapter de assinatura:

```ts
export async function ingestAlertOutboxSignature(tx: IngestTransaction, alertId: string, eventId: string): Promise<string> {
  const [row] = await tx.execute<{ signature: string }>(sql`select public.ingest_alert_outbox_signature(${alertId}::uuid,${eventId}::uuid) as signature`);
  if (!row || !/^[0-9a-f]{64}$/.test(row.signature)) throw new Error("Alert outbox write was not persisted");
  return row.signature;
}
```

- [ ] Executar a parte observacional da Task 4, mais `pnpm --filter @predioon/db typecheck`. Não commitar/publicar 052 pela metade; continuar Task 6 e commitar a migration integral depois dos contratos das duas roles.

## Task 6: Helpers físicos sem ACL de DML

**Files:** completar mesma `infrastructure/052-ingest-runtime-roles.sql`; Create `packages/db/src/access-service-operations.ts`; Tests `packages/db/test/access-service.test.ts` e casos reais de ingest acesso.

- [ ] `access_service_next_pending` guard + query de PENDING por created_at,id com SKIP LOCKED, somente projection indicada no spec. `access_service_expire_commands` usa clock PostgreSQL após locks, expire PENDING/SENT vencidos + audit derivado e confirmação; sem input de deadline. Os adapters convertem timestamps para Date e snake_case para contrato TS explícito.
- [ ] `access_service_mark_sent` guard → `app_mark_access_sent(command_id)` original. Razão não nula gera FAILED+audit se ainda PENDING e volta ao caller; null exige releitura SENT e preservação de identidade/TTL. Sem duplicar autorização/capacidades e sem GRANT no helper original. Testar actor forjado e app.role admin sem alterar requested_by real ou decisão de capacidades.
- [ ] Implementar failPending e failPublish separadamente, com códigos fechados do spec. Derivar mensagens por CASE e audit building/requested_by/gate/command persistidos. Lock linha do comando, negar estado errado sem efeito, nunca escrever createdAt/expiresAt/parents/actor. Não armazenar exceção arbitrária do publisher.
- [ ] Implementar ACK controlado. Predicado decisivo, avaliado depois de esperas e imediatamente antes da UPDATE:

```sql
WITH decision AS MATERIALIZED (SELECT clock_timestamp() AS at)
UPDATE public.gate_commands c
SET status=CASE ack_result WHEN 'EXECUTED' THEN 'ACKNOWLEDGED' ELSE 'FAILED' END,
 acknowledged_at=decision.at,
 failure_reason=CASE ack_result WHEN 'EXECUTED' THEN NULL ELSE 'Abertura recusada pelo controlador' END
FROM decision WHERE c.id=target_command_id AND c.status='SENT' AND c.expires_at>decision.at
 AND c.building_id=target_building_id AND c.gateway_id=target_gateway_id
 AND c.gate_id::text=target_gate_id AND c.device_id=target_device_id
RETURNING c.*;
```

Antes desse statement: guard real, resultado EXECUTED/REJECTED, IDs bounded, lock command, device→gateway→gate, verificar parents/gateway habilitado, inserir audit derivado. Se o prazo/status mudar enquanto audit espera, remover somente audit criado pelo helper e retornar false. Após UPDATE, comparar row esperado/releitura; trigger que skip/rewrite produz rollback40001. Não aceitar prazo ou usuário de input; não usar autorização humana atual de ACK como substituto de resultado físico já enviado.

- [ ] RED específico de ACK durante espera de audit/parent: fixture SENT com expiração próxima, outra conexão segura lock, iniciar ACK, deixar prazo passar, liberar lock; esperar false, sem acknowledgedAt ou audit de sucesso. Negativas de comando estrangeiro, building/gateway/gate/device errados, PENDING, terminal, result fora de enum, repeats e reabertura de terminal. Positivo revalidado aceita um resultado e audita uma vez.
- [ ] Executar Task 4 completa e verificar catálogo dos helpers `service_/ingest_/access_service_` owner/search_path/ACL. Nenhuma nova EXECUTE deve aparecer em predioon_app/identity/broker/notifications ou PUBLIC. Testar RLS e defaults com grant amplo acidental em tabelas privadas em cluster exclusivo, depois restaurar ACL exatamente.
- [ ] Commit local integral de SQL+adapters+contratos: `feat(db): restrict ingest and physical access service operations`. Guardar catálogo pós-migration em evidência sanitizada; não pushar runtime incompleto.

## Task 7: Migrar observação e preservar provas 048/038

**Files:** Modify `services/ingest/src/pipeline/{telemetry,gateway-status}.ts`, `offline-sweeper.ts`, `analytics/usage.ts`, `rules/evaluate.ts`, `parking/index.ts`, `notify/index.ts`, `features.ts`, `realtime.ts`; Modify `services/ingest/test/{receipt-policy,pipeline,water,sensors,sensors.integration,usage,parking,feature-pause,outbox-producers.integration}.test.ts` e fixture administrativa real.

- [ ] Antes do switch, adicionar casos de trigger reescrevendo campo seguro de gateway e trigger tardio mudando heartbeat/source/outbox que ainda devem reverter tudo. Adicionar lock de perfil positivo e negativa de UPDATE tariff pela role real. Caso regra global cria alerta em device A, depois leitura device B e confirma cooldown compartilhado do condomínio; leitura de alerts não pode estreitar ao device corrente.
- [ ] Trocar imports de observação por `@predioon/db/ingest` e `db` local por `ingestDb`. Trocar tipos por `IngestTransaction`. Em todos os select/returning/reselect device/gateway, usar projeção explícita da Task 3. Em building/rule usar projeções autorizadas. Manter raw projection JSONB que preserva string literal e o último expected por chave de PersistenceChecks.
- [ ] Remover SQL direto de rejection, usar countIngestRejection. `accountUsage` usa lockMonitoringProfiles e depois leitura normal; upsert `set` exclui identidade. Mudança de cursor concreta:

```ts
await tx.insert(usageCursors).values(cursorValues).onConflictDoUpdate({
  target: usageCursors.profileId,
  set: { lastAt: cursorValues.lastAt, lastValue: cursorValues.lastValue,
    good: cursorValues.good, continuousSeconds: cursorValues.continuousSeconds },
}).returning();
```

No dailyUsage, `set` tem exatamente incomplete/quantity/estimatedCost/coveredSeconds/resets/samples/firstAt/lastAt, sem profileId/buildingId/day. Não mudar os valores calculados ou sequência de comparações.

- [ ] `persistAlert` mantém expected, assertPersisted e checks finais, mas usa persistIngestAlert para INSERT+enqueue. Lê alerts para confirmar envelope e lembra assinatura retornada. Substituir outboxSnapshot por wrapper que retorna assinatura, lembrada em `checks.remember("outbox:"+eventId,...)`; nenhuma tabela privada aparece no SQL TS produtivo. Outros escritores e triggers tardios continuam podendo invalidar a transação.
- [ ] `applyParkingTelemetry` substitui SELECT FOR UPDATE direto por lockParkingLot e mantém `acceptParkingReading` depois desse lock; substitui UPDATE+INSERT audit por writeParkingObservation, passando identidade/versão/source explicitamente. Offline/status preservam acompanhamento de fonte habilitada em building inativo; candidato stale nunca é autorização de mutation. SSE continua pós-commit e revalida alert/feature; falha de notify não repete source/outbox.
- [ ] Separar fixtureadmin das conexões em teste. Usar `TEST_INGEST_DATABASE_URL` no pool de setup, prepararconfig restrita antes de importar handler e retirar DATABASE_URL de env produtivo/filhos. Tests de produtores hoje importam `@predioon/db` e interceptam `database.db.transaction`: mudar interceptação para `ingestDb`, mantendo owner somente para triggers/asserts/cleanup. Unit mocks podem seguir, mas catálogo/ACL e atomidade usam login real; afirmar role efetiva no começo de cada suite integrada.
- [ ] Executar e registrar dirigidos:

```powershell
pnpm --filter @predioon/ingest exec node --import tsx --test --test-concurrency=1 test/receipt-policy.test.ts test/pipeline.test.ts test/water.test.ts test/sensors.integration.test.ts test/usage.test.ts test/parking.test.ts test/feature-pause.test.ts
pnpm --filter @predioon/ingest exec node --import tsx --test --test-concurrency=1 test/outbox-producers.integration.test.ts
```

Nos produtores, manter todos os casos existentes BEFORE skip/AFTER rewrite, receipt/raw/value literal, alertsource/event/delivery/witness, cursors/usage/heartbeats, late writer, rollback e SSE indisponível. Acrescentar script/query proibida de metadata para provar que GREEN não se deve a login owner. Commit local: `refactor(ingest): run observation with restricted database credentials`.

## Task 8: Migrar dispatcher/ACK e provar ausência de replay

**Files:** Modify `services/ingest/src/access/{dispatcher,publish}.ts`; Modify tests `access-dispatch.test.ts`, `access.integration.test.ts`, `access-capabilities.integration.test.ts`, `feature-pause.test.ts`, `access-simulator.test.ts`.

- [ ] RED no dispatcher usando guard/helper reais: não há queries `update(gateCommands)`/`insert(auditLogs)` ou poolowner no caminho; mocks devem representar a interface da role física. Reusar todas as provas034 de revogação/timewindow, actor/current grants, parent swaps, conexão/stale/TTL e espera audit antes de SENT.
- [ ] Trocar por `@predioon/db/access-service`; preservar dispatcherTail e outer featureTx. Ordem concreta:

```ts
await accessServiceDb.transaction(expireAccessCommands);
await accessServiceDb.transaction(async featureTx => {
  await lockFeatures(featureTx);
  const command = await accessServiceDb.transaction(async tx => {
    const pending = await nextPendingAccess(tx);
    if (!pending) return null;
    if (!client.connected) { await failPendingAccess(tx, pending.id, "NO_LIVE_CONNECTION"); return null; }
    if (pending.createdAt < connectedSince()) { await failPendingAccess(tx, pending.id, "BEFORE_CONNECTION"); return null; }
    const features = await readFeatures(tx, pending.buildingId);
    if (pending.gateKind && !permitsFeature(features, gateFeature(pending.gateKind), pending.createdAt)) {
      await failPendingAccess(tx, pending.id, "FEATURE_PAUSED"); return null;
    }
    return await markAccessSent(tx, pending.id) === null ? pending : null;
  });
  if (!command) return;
  try { await publishAccessCommand(client, command, connectedSince()); }
  catch (error) { await accessServiceDb.transaction(tx => failAccessPublish(tx, command.id, publishFailureCode(error))); }
});
```

`publishFailureCode` está definido no mesmo publisher: erro `AccessPublishError` carrega enum fechado, erro desconhecido mapeia PUBLISH_FAILURE. O helper consegue detectar ACK que já venceu a corrida e não o substitui por FAILED. Não mover publish para a transação SENT.

- [ ] Publisher mantém qos0/retainfalse/queueQoSZero false, conexão ativa, createdAt>=connectedSince, expiry futura e timeout<=2s/deadline. Trocar somente classes/códigos de seus erros. Nenhum retry no catch; nenhuma alteração de ação OPEN/issuedAt/expiresAt. ACK TS conserva parsing e topic checks e chama applyAccessAck dentro de transação física.
- [ ] Escrever prova de queda após SENT/antes de publish com subprocesso/failpoint de teste: conferir SENT sem publish, reiniciar dispatcher, zero reenvios; depois expiry é registrada. O failpoint não é flag do runtime produtivo. Dois dispatchers selecionam comandos diferentes com SKIP LOCKED; featurepause aguarda o outerlock até publish terminar. Republish/reconnect não usa comando anterior à conexão.
- [ ] Executar com `RUN_ACCESS_DB_TESTS=1` e roles reais:

```powershell
pnpm --filter @predioon/ingest exec node --import tsx --test --test-concurrency=1 test/access-dispatch.test.ts test/access.integration.test.ts test/access-capabilities.integration.test.ts test/access-simulator.test.ts test/feature-pause.test.ts
pnpm --filter @predioon/db exec node --import tsx --test --test-concurrency=1 test/access-service.test.ts
```

Esperado: zero skips/falhas e provas negativas de novos helpers; fixtures owner não executam dispatcher/ACK. Commit local: `refactor(ingest): isolate physical dispatch and acknowledgement privileges`.

## Task 9: Provisionar seis roles e proteger ledger

**Files:** Modify `packages/db/src/provision-runtime-roles.ts`, `infrastructure-migrations.ts`; Modify tests runtimeprovisioning/runtimeconnection/infrastructuremigrations/migrationrunner/bootstrap/notificationdelivery/physicalfeatures conforme listas/counts.

- [ ] RED de validação completa: sexta credencial ausente/inválida/crossdb impede abrir cliente; sexta role com membership incoming impede provisionar. Explicar para teste que map de runtimeRoleCredentials é completamente avaliado antes de postgres(...), como hoje. Erros só nomeiam variável/role, sem password/DSN/drivercause.
- [ ] Trocar condição de memberships do provisioner por ambos sentidos para as novas roles; senha seis roles permanece dentro do begin existente. Verificar rollback de falha tardia por autenticação com valores antigos/novos gerados em memória, sem selecionar/imprimir rolpassword. Não criar GRANTs no provisioner.
- [ ] Adicionar seis roles ao hardeningledger e mensagens. Testar schema_migrations SELECT/INSERT/UPDATE/DELETE negados a cada uma e RLS mesmo depois de grant amplo acidental. Protegerledger em cada migration como hoje; a checker não endurece nem cria estado.
- [ ] Atualizar números finais52/six nos testes que refletem chain completa; manter fixtures históricas<=26/034/038 claramente históricas. Não substituir todo literal51 indiscriminadamente. Testar que reexecução não altera login/senhas ou chama SQL já registrado.
- [ ] Executar:

```powershell
pnpm --filter @predioon/db exec node --import tsx --test --test-concurrency=1 test/runtime-provisioning.test.ts test/runtime-connection.test.ts test/infrastructure-migrations.test.ts test/migration-runner.test.ts test/bootstrap.test.ts
```

Commit local: `feat(db): provision and validate six runtime credentials atomically`.

## Task 10: Ambiente local e contrato de deployment

**Files:** Create `services/ingest/.env.runtime.example`, `scripts/write-ingest-runtime-env.mjs`, `scripts/test-ingest-runtime-env.mjs`; Modify `.gitignore`, `.env.example`, `infrastructure/.env.prod.example`, `infrastructure/docker-compose.prod.yml`, `infrastructure/setup-prod.sh`, scripts start-local/test-start-local, `packages/db/test/deployment-contract.test.ts`.

- [ ] RED do CLI de projeção em diretório temporário: arquivo administrativo de fixture contém owner+outrasroles+sentinel e paresrestritos; arquivo runtime gerado contém somente allowlist, não contém sentinelowner, permissions privadas e stderr/stdout sem valores. Se destinojáexiste com configuração diferente, falhar e deixar intacto; não sobrescrever segredo/customização silenciosamente. Input inválido impede criação de arquivo parcial. Invocar CLI explicitamente com paths testáveis; nunca importálo pelo runtime.
- [ ] Implementar `write-ingest-runtime-env` como CLI administrativo com allowlist do spec, validação dos dois pares antes de write e gravação exclusiva/atômica. Exportar função pura `projectIngestRuntimeEnvironment(input)` para teste; ler adminfile só nessa execução. Acrescentar chamada no setup local após preparo/provisionamento, e verificar existência/configuração no startup local antes de `pnpm dev`. Exemplo dedicado tem ambasurlsrestritas e chavesoperacionais com valores locais públicos, jamais owner.
- [ ] Compose ingest define NODE_ENV production, DATABASE_URL_INGEST, DATABASE_URL_ACCESS_SERVICE e MQTT/offline; nenhuma DATABASE_URL/URL de outra carga. Adicionar INGEST_DB_PASSWORD/ACCESS_SERVICE_DB_PASSWORD aos exemplosprod e validação inicial de setup-prod. API container permanece com seus três pares; notifications só com seu par.
- [ ] Setup stop/ps precede migration; conferir seis credenciais necessárias antes de stop/mutation. Provisionamento recebe owner+seisURLs no CLI run transitório, não no container persistente. Preservar `MQTT_CLIENT_ID`, volumes/sessionbroker e sequência bootstrap→infra→provision→startup; teste de contrato bloqueia iniciar plataforma se qualquer senha/stop/ps/provision/verify falhar. Runbook especifica backup/restore anterior à aplicação real.
- [ ] Executar:

```powershell
node --test scripts/test-ingest-runtime-env.mjs
powershell -NoProfile -File scripts/test-start-local.ps1
pnpm --filter @predioon/db exec node --import tsx --test test/deployment-contract.test.ts
```

Deployment test tem skips de bash no Windows; prova integral deve ser executada no Linux CI e declarar zero skips ali. Não usar `docker compose config` imprimindo valores resolvidos; conferir estrutura por parse sem divulgar secrets. Commit local: `chore(infra): pass purpose-specific ingest runtime credentials`.

## Task 11: Restore, broker real e CI dedicado

**Files:** Modify `packages/db/test/backup-restore.test.ts`, `notification-delivery.test.ts`, `.github/workflows/ci.yml`, `services/ingest/scripts/{verify-broker,broker-session-rehearsal}.ts/.mjs`; Create `services/ingest/test/mqtt-runtime.integration.test.ts`, `services/ingest/test/fixtures/mqtt-runtime-receiver.ts`.

- [ ] Estender snapshotrestore para defaults e prefixosingest_/access_service_/service_; manter ACLefetiva/owner/proconfig/definition/RLS/colunas/totaisconteúdo. Criarseis roles NOLOGIN e databaseACLseis antes de pg_restore. Alterar assertions final52/6 e provisionfixture todos os pares, usando senhas aleatórias em memória.
- [ ] Depois de restore mesmo/outrocluster: autenticar novos logins, telemetry→usage/alert/outbox e parking/audit positivos, mark/ACK positivos e negativessecrets/DML/human/física inversa. Restaurar relógios/parents/grants da fixture de forma exata e limpar somente UUIDs criados. Cataloguesource/target devem coincidir nos itens públicosprivadosprevistos, sem logar passwordhash.
- [ ] MQTT runtime test acrescenta PostgreSQL à prova hoje baseada em ledgerdearquivo. BrokerpublicaQoS1; travar transação/trigger em fixture owner e observar ausência de PUBACK enquanto uncommitted; matar receiver antes do commit gera rollback e reentrega do broker uma vez; matar depois do commit e antes do callback preserva source/dedup/usage/outbox e reentrega sem duplicar. Receiverchild recebe somente pares restritos/MQTT. Testar callback do stream antigo, retained como histórico e falha de SSE sem reexecução. ComandosOPEN desse teste continuam qos0/noretain/noofflinequeue/noretry.
- [ ] Atualizar ensaios de broker EMQX para usar novasURLsrestritas no receiver, mantendo admin only setup/asserts fora dele. Testemqtt com aedes não substitui ensaio de sessão durávelEMQX; registrar ambos sem somar totais como se fossem integralúnica.
- [ ] CI geral provisiona seis roles antes dos tests, passa dois pares ao subprocesso produtivo e varadministrativatest somente fixtures. Acrescentar job isolado `ingest-runtime-contracts` com cluster físico próprio, TEST_INGEST_DISPOSABLE_DB=1, adminfixtureURL/containerID e duasroles; executa ACL, físicos, startup, produtores e brokerDB sequencialmente. Job dedicado de notifications também deve preparar/provisionar novas roles para produtores que migram; manter suiteworker038. Job de backup usa dois containers reais e declara zero skips.
- [ ] Executar comandos em ambientes dedicados com suas variáveis fornecidas pelo launcher seguro:

```powershell
pnpm --filter @predioon/db exec node --import tsx --test --test-concurrency=1 test/backup-restore.test.ts
pnpm --filter @predioon/db exec node --import tsx --test --test-concurrency=1 test/notification-delivery.test.ts
pnpm --filter @predioon/notifications test
pnpm --filter @predioon/ingest exec node --import tsx --test --test-concurrency=1 test/mqtt-delivery.test.ts test/mqtt-runtime.integration.test.ts
pnpm --filter @predioon/ingest exec tsx scripts/verify-broker.ts
pnpm --filter @predioon/ingest exec node scripts/broker-session-rehearsal.mjs
```

Não rodar simultaneamente suites que provisionam roles no mesmo cluster. Esperado: restore2/2 com cluster fisicamente distinto comprovado; suites dedicadas sem skips. Commit local: `test(infra): verify restricted ingest restore and broker boundaries`.

## Task 12: Verificação da release íntegra e publicação por meta

**Files:** atualizações finais dos guias/progressos da lista inicial; novo `docs/evidencias/ingest-runtime-credentials-2026-10-13.json` somente após resultados, ou datareal da conclusão.

- [ ] Revisar catálogo completo antes/depois em cluster exclusivo: seisloginrestritos, memberships em ambos os sentidos zero, ownership zero, table/column/function/defaultACLpermitida, RLS de serviço, helpersprivados, ledger 52 e SQL001–051 bytepreservados. Revisar grafo prod sem owner/envadmin/apppool e Compose com somente pares da carga. Confirmar startupreal e logs sanitizados de falha das duasroles.
- [ ] Executar regressão após todas as mudanças; estes comandos não presumem o estado de um cluster do desenvolvedor:

```powershell
pnpm check:boundaries
pnpm typecheck
pnpm --filter @predioon/db exec node --import tsx --test --test-concurrency=1 test/*.test.ts
pnpm --filter @predioon/ingest test
pnpm --filter @predioon/notifications test
pnpm test
pnpm build
```

Rodar testsdeDB mutando role no launcherisolado, separatemente dos gerais; todos os resultados reais e skips precisam ser atribuídos ao comando/cluster correspondente. Repetir/broaden só se houver mudança/falha/concernnova. Build de imagem ingest e startup de container fazem parte do CI de release, sem deployreal.

- [ ] Registrar fonte HEAD e tree, comandos, envflagssem valores, versões, start/end/duração, totaispass/fail/skip e localização da evidência de catalogues/restore/broker. Se houver skip que cubra uma garantia requerida, não declarar a garantia entregue. Separar integral de dirigidos; mocks não viram prova deACL. Não registrar DSNs, passwordhashes ou snapshots privados.
- [ ] Atualizar guiasdeenv/setup/DEPLOY/MIGRATIONS/NOTIFICACOES e estado deINBOX_DECISOES/MELHORIAS/productplan: owner saiu da ingestãocompleta somente após provas; fila permanece adiada e consumidores/retention/capacidade/firmware/rolloutreal continuam pendentes. Remover comentário em `packages/db/src/index.ts` que nomeia ingest produtivo como usuário owner; manter CLIadmin explícito.
- [ ] Usar skill requesting-code-review para revisar conformidade e qualidade da release, com foco em fronteiras/catálogo/atomidade/físico/restore. Corrigir achados materiais e rerodar somente testes afetados, então verificação final. Não introduzir política de replay/queue ou aprovação opcional em função dessa revisão.
- [ ] Publicar uma meta íntegra: commits locais podem seguir as verticais acima, mas push do runtime ocorre quando observação **e** acesso estão restritos e a migration/provision/config/restore são compatíveis. `git diff --check`, `git status --short`, `git log` devem conferir lista exata antes do commit/push. Não incluir alteraçõesdeoutros agentes ou segredos. Atualizar evidência com SHA final; push autorizado ao branch atual, com remoto/CI conferidos pela raiz. Não marcar2B.5workers restantes/etapa 3 toda como concluída.

## Cobertura do spec e critérios para fechar

| Obrigação do spec | Tarefas |
|---|---|
| Preparo compatível de loading, publicável antes da separação de credenciais | 1 |
| Dois pools, nenhum owner/app pool/env owner produtivo, identidade PG real | 2,3,8,10,12 |
| Projeções seguras e confirmação contra triggers | 3,5,7 |
| ACL/RLS/guard/defaults sem GUC de máquina/grants humanos | 4,5,6,9,11,12 |
| Locks de perfil sem configuração, uso/regra/cooldown global | 4,5,7 |
| Source+outbox atômicos e assinatura privada | 4,5,7,11 |
| Estacionamento: lock privado, observação e audit SYSTEM com parents | 4,5,7 |
| Dispatcher/ACK, app_mark original, clocks/locks/terminal/TTL | 4,6,8 |
| QoS/PUBACK/retained/dedup/freshness/features/SSE/físico | 7,8,11 |
| Validar seis antes de conectar/mutar e rollback/proteger ledger | 2,4,9 |
| Setup/Compose/CLI admin/CI/restore mesmo e outro cluster | 9,10,11 |
| Evidência honesta, revisão e publicação completa por meta | 12 |

O último requisito é observável: o container iniciado com somente DATABASE_URL_INGEST e DATABASE_URL_ACCESS_SERVICE verifica ambasroles, processa uma leitura e um pedido/ACK autorizados, rejeita os negativos de cada carga e não tem caminho de import/config/conexão owner. Uma implementação que mantenha owner no dispatcher ou conceda direitos deworkeroutbox para viabilizar snapshot não satisfaz este plano.
