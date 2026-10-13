# Distribuição de ordens no app Operação — implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** abrir e atribuir ordens no app Operação pelas capacidades e API atuais.

**Architecture:** lista validada + autoridade atual para distribuição; diretórios de pessoas/equipes com autorização própria e paginação explícita; controller de gravação específico conserva contexto/versão e impede replay. Nenhuma mudança de API/SQL/bibliotecas.

**Tech Stack:** React Native 0.87.1 sem Expo, React 19.2.3, TypeScript, node:test e host React instrumentado.

Base publicada: `7ff57a4`. [Desenho](../specs/2026-10-12-native-work-order-distribution-design.md). A autorização vem do plano de produto já aprovado; este recorte só acrescenta um consumidor das regras existentes. Raiz conserva docs/Git/DB/builds; implementador toca somente a fonte e testes mobile listados.

## Tarefa 1 — domínio e transportes

Criar `packages/mobile/src/work-order-distribution.ts` e `packages/mobile/test/work-order-distribution.test.ts`. Tipos de payload vêm de `@predioon/contracts/work-orders`; diretórios usam CursorPage/TeamView de tenancy e pessoa local id/nome.

- [x] Escrever RED que faz uma API fake registrar rota/body e recusa títulos vazios/161 caracteres, descrição 4001, prioridade inválida, ID não selecionável, prédio divergente, versão inválida e ordem encerrada.

```ts
const calls: unknown[] = [];
const api = { post: async (path: string, body: unknown) => { calls.push([path, body]); return currentOrder; } };
// Ao enviar o draft validado, conferir o corpo real:
assert.deepEqual(calls, [["/v1/work-orders", {
  buildingId: "one", title: "Trocar lâmpada", description: "Garagem", priority: "NORMAL",
  assignedUserId: null,
  assignedTeamId: "11111111-1111-4111-8111-111111111111",
}]]);
```

- [x] A partir da raiz do worktree, rodar `node --experimental-strip-types --test packages/mobile/test/work-order-distribution.test.ts`; falha deve ser assertiva de comportamento, não loader/setup.
- [x] Implementar funções locais de gate, validação/payload e transportes POST/PATCH existentes. Preservar `version` e exatamente um tipo de responsável; sem responsável usa dois null. Validar identidade/prédio/versão da resposta antes de afirmar sucesso.
- [x] RED/GREEN de `/v1/tenancy/people` e `/v1/tenancy/teams`, limit=100/after real, autorização independente, cópia id/nome, equipes ativas do prédio, cursor/duplicatas inválidos e 403 distinto de rede. Carregar páginas adicionais por ação explícita.
- [x] Rodar os testes de domínio e preservar logs RED/GREEN reais em `.local/native-work-order-*`.

## Tarefa 2 — controller de gravação

Criar `packages/mobile/src/work-order-distribution-controller.ts` e `packages/mobile/test/work-order-distribution-controller.test.ts`; não alterar mutation-runner/hooks genéricos.

- [x] RED com Promise adiada: duplo submit produz um envio; invalidar contexto/gate/versão/lifecycle antes de resolver/rejeitar não produz feedback ou reset/reload atual.

```ts
const pending = deferred();
// Capturar callbacks e iniciar duas vezes na mesma geração.
// Conferir calls.length === 1 antes de resolver pending.
// Invalidar a geração, resolver a resposta e conferir feedback.length === 0.
```

- [x] Implementar controller com estado/assinatura por contexto, barreira síncrona de pendência e geração atual antes/depois do pedido. Guardar também side effects internos, não só setSuccess/setError externos.
- [x] RED/GREEN de 400 corrigível, 403/404 ação inválida, 409 versão antiga, rede/5xx/confirmação incompatível incerta; mensagens fixas e nenhuma repetição automática. Recomeço é ação explícita após conferir lista.
- [x] Provar deactivate→activate/StrictMode sem tornar corrente o callback de uma geração anterior; descarte não desfaz servidor.

## Tarefa 3 — integração e formulários

Modificar `packages/mobile/src/app.tsx`, `packages/mobile/src/work-orders-screen.tsx`, `packages/mobile/src/work-orders.ts` e `packages/mobile/test/work-orders.test.ts`. Criar `packages/mobile/src/work-order-distribution-screen.tsx`, `packages/mobile/test/work-order-distribution-screen.test.ts`, `packages/mobile/test/fixtures/work-order-screen-host.mjs`.

- [x] RED renderizado em Android/iOS: manutenção executa sem nova criação/diretórios; gestor seleciona equipes; síndico seleciona pessoas/equipes. Gate exige autoridade atual + lista canDistribute válida.
- [x] Passar capacidades atuais de BuildingApp à tela WorkOrders. Manter seu View/fragmento/scroll estável. Lista validada deve recusar itens de outro prédio e invalidar controles após erro/negação.
- [x] RED/GREEN do leitor read-assigned sem update-assigned: lista/histórico continuam disponíveis, status/anotação ausentes. Execução/anotação exige distribuidor atual ou read-assigned + update-assigned + assignedToMe atual, sem ampliar grants.
- [x] Formulário Nova ordem de serviço com Field de título/descrição, prioridade por botões atuais e responsável opcional. Formulário explícito de atribuição só em OPEN/IN_PROGRESS; seleção não envia até confirmar. Seletores consultam somente quando abertos e com autorização própria; não exibem e-mail/IDs privados.
- [x] Conectar controller com cleanup de lifecycle e revalidação de contexto/versão/seleção. Atualizar lista no sucesso atual; mensagens fixas nos erros; fluxo explícito conferir lista para confirmação incerta.
- [x] Provar paginação de opções, mudança de seleção após revogação, perda de canDistribute/capability, troca de condomínio/API/sessão, alteração de versão durante edição, background/foreground, respostas tardias, unmount e StrictMode. Provar um POST/PATCH por ação.
- [x] Preservar execução/histórico/consumo e a ausência do domínio no Morador; executar integral mobile e tipos dos consumidores móveis.

## Tarefa 4 — revisão e publicação pela raiz

- [x] Congelar fontes finais com os 11 hashes reais e EOF/whitespace limpos; reportar conjunto exato.
- [x] Conformidade independente e depois qualidade; corrigir/revisar achados materiais.
- [x] Raiz repetir `pnpm --filter @predioon/mobile test`, cliente/UI, quatro typechecks e `pnpm check:boundaries` sobre fonte congelada; registrar contagens reais e diff-check do índice.
- [x] Raiz gerar quatro bundles JS de release sequenciais com dois workers. Não usar aparelho, API real ou Docker do proprietário como teste compartilhado; nenhum aceite nativo por host.
- [x] Registrar evidência sanitizada, continuidade/tracker/melhorias e limites.
- [ ] Commit/push somente fontes desta meta e docs próprios; comparar SHA remoto.

## Estado

Implementação e verificação final concluídas em 13/10; publicação é o último checkpoint. Mantido o ownership de 11 arquivos mobile, sem nova dependência, migration, backend ou mudança dos hooks genéricos. Prazo, vínculos e paginação de ordens ficam nos recortes seguintes já identificados.

**Provas finais:** foco 64/64; integral própria da raiz mobile **219/219**, cliente **75/75** e UI **93/93**, zero falhas/skips/cancelamentos. Quatro typechecks, fronteiras, quatro bundles JS de release Morador/Operação × Android/iOS e conferência dos 11 hashes/EOF passaram. Conformidade PASS e qualidade APPROVED; [evidência sanitizada](../../evidencias/native-work-order-distribution-2026-10-13.json).

**Revisões e correções:** o primeiro parecer reproduziu busca local e callback antigo na reabertura da ficha; a key passou a incluir sua geração. O segundo reproduziu Conferir lista antigo fechando ficha nova; os botões externos agora capturam geração e gate, junto dos handlers de formulário já protegidos. REDs próprios 45 casos/3 falhas e 52/7 foram preservados, seguidos de GREENs 45/45 e 52/52. As integrais anteriores 209 e 212 não aprovam a fonte posterior; a raiz repetiu 219 e os bundles na fonte final.

Não há aceite de aparelho/Fabric/Hermes, APK/Apple/XCTest/Keychain, CI novo, navegador ou produção. Descartar callback não desfaz uma transação enviada; perda da resposta continua confirmação incerta, sem reenvio automático.
