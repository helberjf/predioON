# Recuperação de senha na entrada mobile — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** permitir solicitar o link de recuperação existente a partir dos dois aplicativos.

**Architecture:** transporte público stateless para a API047 e formulário compartilhado de React Native. O link e a troca de senha permanecem no portal existente. A lógica de sessão e MFA não ganha operações novas.

**Tech Stack:** TypeScript, React Native sem Expo, node:test e host React instrumentado já presentes.

Design: [contratos e limites](../specs/2026-10-07-native-password-recovery-design.md).

## Tarefa1 — contrato do transporte público

**Files:** `packages/api-client/src/index.ts`, `packages/api-client/test/password-recovery.test.ts`.

- [x] Escrever testes contra a exportação pública ausente, verificar o RED e implementar somente o helper restrito ao endpoint de recuperação.
- [x] Capturar URL/init e verificar `POST`, `{email}`, headers sem credenciais, omit/no-store/signal, uma chamada e nenhuma renovação.204 não deve ler JSON;400/401/403/429/503/rede e200/202 não podem mostrar o corpo.
- [x] Executar o GREEN e a integral `pnpm --filter @predioon/api-client test`; preservar os testes existentes de troca de identidade, rotação e perda de resposta.

Interface da função:

```typescript
export async function requestPasswordRecovery(
  options: { baseUrl: string; fetch: typeof globalThis.fetch },
  email: string,
  signal?: AbortSignal,
): Promise<void>
```

## Tarefa2 — controller e formulário compartilhados

**Files:** `packages/mobile/src/password-recovery.ts`, `packages/mobile/src/password-recovery-screen.tsx`, `packages/mobile/test/password-recovery.test.ts`, `packages/mobile/test/login-recovery-screen.test.ts`.

- [x] Escrever REDs para validação, envio único síncrono, bloqueio de edição, feedback genérico, cancelamento, geração/reabertura e resposta tardia. Somente timers de transporte existentes; nenhuma retentativa.
- [x] Implementar o controller mínimo com email/pending/error/requested, geração, AbortController e lifecycle reativável; reutilizar o padrão de listeners/snapshot dos controllers móveis existentes.
- [x] Renderizar o formulário com `Card`, `Field`, `Button` e `ErrorMessage`; `email-address`, autoCapitalize none, maxLength254, botão enviar e voltar. Reutilizar o comportamento do teclado iOS.
- [x] Testar handlers e lifecycle na árvore React renderizada, em ambos produtos/OS, incluindo submit e tap simultâneos, StrictMode, cancelamento e erro sanitizado. O host instrumentado comprova React; não alegar execução nativa.

## Tarefa3 — entrada compartilhada nos dois apps

**Files:** `packages/mobile/src/login.tsx`, `packages/mobile/src/app.tsx`, fixture de host usada pelos testes.

- [x] Extrair a entrada existente para testá-la sem carregar Keychain e domínios; conservar login/MFA e provar esse comportamento. Essa extração mecânica não adiciona recuperação antes do RED.
- [x] Observar o RED do botão ausente na entrada renderizada, depois adicionar Esqueci minha senha e alternância que desmonta a entrada. Provar descarte de senha/código ao navegar e guarda síncrona contra navegação durante login.
- [x] Em `ConnectedApp`, injetar o helper público usando `api.baseUrl` já validado e `boundedFetch`. Não introduzir outra origem configurável ou alterar `engine.ts`/`web-client.ts`.

## Tarefa4 — verificação e publicação

- [x] Revisão de conformidade, depois qualidade; corrigir achados materiais e revisar novamente.
- [x] Integral mobile: `pnpm --filter @predioon/mobile test`. Repetição independente da raiz de cliente/mobile e tipos de API-client/mobile/resident-mobile/operations-mobile, fronteiras e diff-check.
- [x] Gerar os dois bundles de release com `react-native bundle --platform android --dev false`; conferir presença da entrada/formulário e hashes da fonte. Build/bundle JS não é aceite nativo.
- [x] Atualizar continuidade, autenticação e melhorias com evidência/limites; manter entrega Resend real e homologação nativa pendentes.
- [ ] Commit/push apenas após verificação própria e conferir o SHA remoto.

## Estado

Implementação, revisões e verificação concluídas; publicação é o último checkpoint.

A extração mecânica passou 4/4 antes da funcionalidade. REDs: entrada/transporte 18 casos (4 aprovados/14 falhas); controller 10 falhas; tela renderizada 28 casos (4 aprovados/24 falhas). São execuções distintas, não somadas. A ausência do controller foi exposta como assertiva; a versão final usa import estático.

GREEN dirigido final 57/57. Integrais repetidas pela raiz: cliente 75/75 (1.468,8894 ms) e mobile 127/127 (1.360,0344 ms), zero falhas/skips/cancelamentos. Tipos dos quatro pacotes, fronteiras e diff-check passaram. Conformidade PASS e qualidade APPROVED, revisores somente de leitura. Quatro bundles JS de release foram gerados sequencialmente com dois workers: Morador/Operação × Android/iOS; cada um contém entrada, formulário e rota pública. O bundler conserva o aviso de subpath privado de featureflags no Morador e o aviso de cores do ambiente; nenhuma dependência foi alterada.

[Evidência sanitizada](../../evidencias/native-password-recovery-2026-10-07.json) contém hashes da fonte testada e de sua normalização LF pelo Git, logs e bundles. Não há aceite nativo, Fabric, aparelhos ou envio real. O proprietário configura Resend e PASSWORD_RESET_URL; o link continua no portal. Push permanece fora do escopo.
