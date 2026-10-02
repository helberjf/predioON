# Navegação de acessos do Morador por concessão atual

Recorte de 02/10/2026, sobre o contrato publicado pela migration 034. Corrige a aba Acessos que dependia de `buildings:read` amplo e a carga inicial que parava quando a autorização ampla retornava 403, mesmo havendo concessão válida sobre um portão.

## Contrato e implementação

`readResidentAccess` consulta a autorização atual do condomínio. `gates:read` amplo permite apresentar o módulo. Sem essa capability ampla, consulta `/access?buildingId=...`, cuja API valida concessões sobre portão, controlador ou gateway real. Um 403 significa ausência de leitura; outros erros continuam falha visível, sem fabricar permissão. Uma resposta contendo prédio diferente é recusada.

A evidência da lista serve somente à navegação. Ela não adiciona capabilities à autorização ampla, não permite inventário/gestão e não autoriza comando físico. A tela existente consulta sua lista atual e mantém disponibilidade, confirmação explícita, identificação idempotente, distinção entre SENT/ACKNOWLEDGED e ausência de replay automático. Os controles e o servidor continuam decidindo cada ação.

O estado composto usa `useReadResource`, com chave por condomínio e invalidação ao sair do foreground. A troca de condomínio, erro ou nova leitura negada remove a evidência anterior. `screensFor` compara o prédio da evidência e o prédio selecionado e exige módulo habilitado; uma evidência ausente/negada não cai de volta para capabilities antigas. O produto Operação conserva seus módulos próprios.

## Descoberta básica permanece separada

O contrato real confirmou que `gates:read` sozinho permite a rota de acesso, mas não concede a descoberta básica em `/buildings` e `/features/buildings`. A função `app_can_discover_building` exige a permissão existente `buildings:read`; ela pode estar no **mesmo portão, controlador ou gateway**, sem concessão ampla. A fixture verifica primeiro a negação de descoberta e depois concede essa permissão específica. Esse recorte não amplia RLS nem elimina uma decisão de autorização do backend.

## Evidência e limites

Os testes unitários reproduziram RED antes da implementação: export do adaptador ausente e navegação antiga usando `buildings:read`. Depois passaram 59 testes móveis, incluindo escopo estrangeiro, negação/revogação, erro de rede/servidor e ausência de promoção de capabilities.

O novo `packages/mobile/test/resident-access.integration.mts` passou 1/1 contra API/PostgreSQL reais isolados na porta 5440, com migrations 032–035. Verificou três concessões exatas (gate/device/gateway), somente o portão permitido, inexistência de inventário/gestão, portão não acionável sem `commands:request`, recusa de recurso inexistente/prédio vizinho, revogação e zero comandos persistidos. A fixture limpa somente seus IDs. A primeira execução identificou banco sem 032/033/034; essas aplicações foram feitas separadamente em transações atômicas, sem editar SQL ou adotar um ledger inexistente.

Executar explicitamente com `RUN_MOBILE_DB_TESTS=1`, banco descartável em loopback e as quatro URLs documentadas em `docs/MIGRATIONS.md`:

```sh
pnpm --filter @predioon/mobile test
pnpm --filter @predioon/mobile exec tsc --project test/tsconfig.integration.json
pnpm --filter @predioon/api exec tsx --test ../../packages/mobile/test/resident-access.integration.mts
```

Esse contrato não é uma execução da tela no emulador e não envia abertura física. A integração nativa dessa navegação, aparelhos físicos e entrega por controladores reais permanecem provas distintas. O banco de CI precisa incluir a migration 034 antes de executar o teste.
