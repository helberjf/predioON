# Distribuição de ordens no app Operação — implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** abrir e atribuir ordens no app Operação pelas capacidades e API atuais.

**Architecture:** lista validada + autoridade atual para distribuição; diretórios de pessoas/equipes com autorização própria e paginação explícita; controller de gravação específico conserva contexto/versão e impede replay. Nenhuma mudança de API/SQL/bibliotecas.

**Tech Stack:** React Native 0.87.1 sem Expo, React 19.2.3, TypeScript, node:test e host React instrumentado.

Base publicada: `7ff57a4`. [Desenho](../specs/2026-10-12-native-work-order-distribution-design.md). A autorização vem do plano de produto já aprovado; este recorte só acrescenta um consumidor das regras existentes. Raiz conserva docs/Git/DB/builds; implementador toca somente a fonte e testes mobile listados.

## Tarefa 1 — domínio e transportes

Criar `packages/mobile/src/work-order-distribution.ts` e `packages/mobile/test/work-order-distribution.test.ts`. Tipos de payload vêm de `@predioon/contracts/work-orders`; diretórios usam CursorPage/TeamView de tenancy e pessoa local id/nome.

- [ ] Escrever RED que faz uma API fake registrar rota/body e recusa títulos vazios/161 caracteres, descrição 4001, prioridade inválida, ID não selecionável, prédio divergente, versão inválida e ordem encerrada.

```ts
const calls: unknown[] = [];
const api = { post: async (path: string, body: unknown) => { calls.push([path, body]); return currentOrder; } };
// Ao enviar o draft validado, conferir o corpo real:
assert.deepEqual(calls, [["/v1/work-orders", {
  buildingId: "one", title: "Trocar lâmpada", description: "Garagem", priority: "NORMAL",
  assignedTeamId: "11111111-1111-4111-8111-111111111111",
}]]);
```

- [ ] Rodar `node --experimental-strip-types --test packages/mobile/test/work-order-distribution.test.ts` pelo workspace mobile; falha deve ser assertiva de comportamento, não loader/setup.
- [ ] Implementar funções locais de gate, validação/payload e transportes POST/PATCH existentes. Preservar `version` e exatamente um tipo de responsável; sem responsável usa dois null. Validar identidade/prédio/versão da resposta antes de afirmar sucesso.
- [ ] RED/GREEN de `/v1/tenancy/people` e `/v1/tenancy/teams`, limit=100/after real, autorização independente, cópia id/nome, equipes ativas do prédio, cursor/duplicatas inválidos e 403 distinto de rede. Carregar páginas adicionais por ação explícita.
- [ ] Rodar os testes de domínio e preservar logs RED/GREEN reais em `.local/native-work-order-*`.

## Tarefa 2 — controller de gravação

Criar `packages/mobile/src/work-order-distribution-controller.ts` e `packages/mobile/test/work-order-distribution-controller.test.ts`; não alterar mutation-runner/hooks genéricos.

- [ ] RED com Promise adiada: duplo submit produz um envio; invalidar contexto/gate/versão/lifecycle antes de resolver/rejeitar não produz feedback ou reset/reload atual.

```ts
const pending = deferred();
// Capturar callbacks e iniciar duas vezes na mesma geração.
// Conferir calls.length === 1 antes de resolver pending.
// Invalidar a geração, resolver a resposta e conferir feedback.length === 0.
```

- [ ] Implementar controller com estado/assinatura por contexto, barreira síncrona de pendência e geração atual antes/depois do pedido. Guardar também side effects internos, não só setSuccess/setError externos.
- [ ] RED/GREEN de 400 corrigível, 403/404 ação inválida, 409 versão antiga, rede/5xx/confirmação incompatível incerta; mensagens fixas e nenhuma repetição automática. Recomeço é ação explícita após conferir lista.
- [ ] Provar deactivate→activate/StrictMode sem tornar corrente o callback de uma geração anterior; descarte não desfaz servidor.

## Tarefa 3 — integração e formulários

Modificar `packages/mobile/src/app.tsx`, `packages/mobile/src/work-orders-screen.tsx`, `packages/mobile/src/work-orders.ts` e `packages/mobile/test/work-orders.test.ts`. Criar `packages/mobile/src/work-order-distribution-screen.tsx`, `packages/mobile/test/work-order-distribution-screen.test.ts`, `packages/mobile/test/fixtures/work-order-screen-host.mjs`.

- [ ] RED renderizado em Android/iOS: manutenção executa sem nova criação/diretórios; gestor seleciona equipes; síndico seleciona pessoas/equipes. Gate exige autoridade atual + lista canDistribute válida.
- [ ] Passar capacidades atuais de BuildingApp à tela WorkOrders. Manter seu View/fragmento/scroll estável. Lista validada deve recusar itens de outro prédio e invalidar controles após erro/negação.
- [ ] RED/GREEN do leitor read-assigned sem update-assigned: lista/histórico continuam disponíveis, status/anotação ausentes. Execução/anotação exige distribuidor atual ou read-assigned + update-assigned + assignedToMe atual, sem ampliar grants.
- [ ] Formulário Nova ordem de serviço com Field de título/descrição, prioridade por botões atuais e responsável opcional. Formulário explícito de atribuição só em OPEN/IN_PROGRESS; seleção não envia até confirmar. Seletores consultam somente quando abertos e com autorização própria; não exibem e-mail/IDs privados.
- [ ] Conectar controller com cleanup de lifecycle e revalidação de contexto/versão/seleção. Atualizar lista no sucesso atual; mensagens fixas nos erros; fluxo explícito conferir lista para confirmação incerta.
- [ ] Provar paginação de opções, mudança de seleção após revogação, perda de canDistribute/capability, troca de condomínio/API/sessão, alteração de versão durante edição, background/foreground, respostas tardias, unmount e StrictMode. Provar um POST/PATCH por ação.
- [ ] Preservar execução/histórico/consumo e a ausência do domínio no Morador; executar integral mobile e tipos dos consumidores móveis.

## Tarefa 4 — revisão e publicação pela raiz

- [ ] Congelar fontes finais com oito ou mais hashes reais e EOF/whitespace limpos; reportar conjunto exato.
- [ ] Conformidade independente e depois qualidade; corrigir/revisar achados materiais.
- [ ] Raiz repetir `pnpm --filter @predioon/mobile test`, cliente/UI, quatro typechecks e `pnpm check:boundaries` sobre fonte congelada; registrar contagens reais e diff-check do índice.
- [ ] Raiz gerar quatro bundles JS de release sequenciais com dois workers. Não usar aparelho, API real ou Docker do proprietário como teste compartilhado; nenhum aceite nativo por host.
- [ ] Registrar evidência sanitizada, continuidade/tracker/melhorias e limites. Commit/push somente fontes desta meta e docs próprios; comparar SHA remoto.

## Estado

Desenho/recorte registrado antes da implementação. Lista de arquivos e divisão controller/tela/diretórios podem ser ajustadas pela raiz mediante achado concreto, preservando o escopo e as duas revisões. Prazo, vínculos e paginação de ordens ficam nos recortes seguintes já identificados.
