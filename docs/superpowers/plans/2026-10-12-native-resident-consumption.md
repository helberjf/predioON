# Consumo publicado no app Morador — implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** mostrar somente quantidades diárias de água/energia liberadas pelo síndico no app Morador Android/iOS.

**Architecture:** consumir a projeção 051 da API única por um recurso compartilhado entre menu e tela; capacidades/funcionalidades atuais e um 200 validado decidem disponibilidade. Reutilizar lifecycle/polling/container existentes, sem backend, migration ou dependência nova.

**Tech Stack:** React Native 0.87.1 sem Expo, React 19.2.3, TypeScript e node:test/host React instrumentado.

Base: main `6989248` e recuperação nativa publicada em `7289e18`. [Desenho](../specs/2026-10-12-native-resident-consumption-design.md). A correção de estacionamento foi publicada e confirmada no remoto em `40fa2c3`; o implementador desta meta não toca API, DB, Git, Docker, bibliotecas, documentação ou emuladores. A raiz publica cada meta somente após sua verificação.

## Tarefa 1 — leitor e projeção reduzida

**Files:** criar `packages/mobile/src/resident-consumption.ts` e `packages/mobile/test/resident-consumption.test.ts`.

- [x] Escrever e executar RED de DTO/leitor: URL real `/monitoring/published`, buildingId divergente, tipo/unit/dias/duplicatas/bounds inválidos, today número/null, histórico de 7 dias, somente 403 como recusa; rede/5xx/401/resposta inválida são erros sanitizados.
- [x] Implementar leitor com Pick<ApiClient,"get"> e tipos locais fiéis à resposta051; sem outras consultas e sem novos campos privados. Copiar somente os campos permitidos.
- [x] Implementar janela dos 7 dias a partir do dia civil do servidor, datas reais e DD/MM sem fuso local; formatar uma casa decimal pt-BR/fallback, conservar null/zero/lacunas/parcial.
- [x] GREEN do leitor/projeção; preservar o RED real e não usar falha de import/setup como evidência.

## Tarefa 2 — evidência atual no menu

**Files:** `packages/mobile/src/scope.ts`, `packages/mobile/test/scope.test.ts`.

- [x] RED de Screen consumption ausente antes de evidência de resposta autorizada, com403, prédio divergente, permissão técnica, PUMP/WATER_TANK e produto Operação.
- [x] Acrescentar evidência vinculada ao prédio e gate exclusivo de Morador + monitoring:read-published + ENERGY_CONSUMPTION/WATER_CONSUMPTION atuais. Metadados de versão das features podem ser opcionais; não inferir poder pelo produto/papel.
- [x] GREEN com energia/água, revogação, perda de funcionalidade, vazios e Operação sem mudança.

## Tarefa 3 — recurso compartilhado e apresentação

**Files:** `packages/mobile/src/app.tsx`, novo `packages/mobile/src/resident-consumption-screen.tsx`, novo teste renderizado `packages/mobile/test/resident-consumption-screen.test.ts`; adaptar fixture de host somente se necessário.

- [x] RED renderizado para hook+menu+tela: só um GET por ciclo, primeira leitura pendente, 403/reliberação, erro/retry, null/zero/lacuna/parcial e textos corretos nos hosts Android/iOS.
- [x] Reutilizar useReadResource no nível de BuildingApp; useCallback para reader, chave com buildingId e revisões reais relevantes. O transporte faz GET só na rota real, sem version/revision fictícias na URL HTTP.
- [x] Adaptar título, Scope e conteúdo com o mesmo recurso; não acrescentar ScrollView, custo/configuração/medidores ou consumo ao app Operação. Exibir feedback de falha sem confundir recusa e indisponibilidade de rede.
- [x] Provar mudança de feature mesmo enabled→enabled com versão nova, capability/contexto/usuário/sessão, background/foreground, StrictMode, late success/error e cleanup. Preservar View/fragmento de BuildingScreen e testes do renderer.
- [x] GREEN e integral mobile; não alegar aparelho/Fabric por teste React host.

## Tarefa 4 — revisão e publicação pela raiz

- [x] Conformidade independente, depois qualidade; corrigir/revisar achados materiais.
- [x] Repetir mobile/cliente/UI, tipos dos consumidores móveis, fronteiras e diff-check com fonte final congelada.
- [x] Gerar quatro bundles JS de release Morador/Operação × Android/iOS, sequencialmente com dois workers; verificar presença da nova tela no Morador e nenhuma mudança da experiência Operação.
- [x] Registrar evidência sanitizada, atualizar continuidade/melhorias/tracker com contagens reais e limites; manter polling de 15 s+pedido e homologação nativa pendentes.
- [x] Commit/push da meta verificada, sem incluir outros drafts; conferir SHA remoto.

## Estado

Publicado em `7ff57a4c490d02a31c55a2b0b87caef78f89c25c` em 12/10, com push e SHA remoto confirmados. Autorização vem do plano de produto já solicitado e da política051 documentada; nenhuma decisão adicional de produto foi introduzida.

REDs separados: leitor/escopo 21 casos (14 aprovados, 7 falhas), chave 7 (6/1), tela renderizada 12 (1/11) e consistência 8 (7/1); falhas de setup não contam. GREEN dirigido 44/44. A raiz repetiu mobile **157/157**, cliente **75/75** e UI **93/93**, sem falhas, cancelamentos ou skips; quatro tipos, fronteiras e quatro bundles JS de release passaram. Conformidade PASS e qualidade APPROVED repetiram 44/44 cada, com oito hashes preservados. [Evidência sanitizada](../../evidencias/native-resident-consumption-2026-10-12.json).

A revogação remota é observada numa releitura; o intervalo automático de 15 s começa após o pedido anterior. Sem prazo máximo fixo, push, mudança de backend/migration/bibliotecas ou aceite em aparelho/Fabric/Apple.
