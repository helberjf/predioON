# Alertas do síndico — plano de implementação

> **For agentic workers:** Executar em linha nesta sessão usando executing-plans, preservando os trabalhos de demonstração não relacionados já presentes no checkout.

**Goal:** Tornar os alertas compreensíveis ao síndico e manter os dados originais em informações técnicas expansíveis.

**Architecture:** Manter a API e a autorização existentes. Extrair somente a tradução de tipos e situações para um módulo local de apresentação; a página agrupa os registros e usa `details/summary` nativo para os dados técnicos.

**Tech Stack:** React, TypeScript, Tailwind, Vite e Playwright Chromium.

## Tarefas

- [x] Criar `scripts/verify-alert-panel.mjs`, que carrega o componente real por Vite e intercepta exclusivamente HTTP local com fixtures. Executar `node scripts/verify-alert-panel.mjs`; a tela anterior falhou por não conter os grupos aprovados.
- [x] Criar `apps/building-web/src/pages/alert-presentation.ts` com títulos e orientações para os tipos usados pelo produto, fallback para tipos personalizados e classificação conservadora de situações desconhecidas.
- [x] Alterar `apps/building-web/src/pages/Alerts.tsx`: grupos por situação, títulos legíveis, indicação de demonstração, ação explicada e `details` fechado com todos os dados originais. Preservar a lógica de autorização por alerta/equipamento/central.
- [x] Atualizar nomes de ações nos seletores em `e2e/specs/permissions/resource-actions.spec.ts` e `e2e/specs/community/notices.spec.ts` sem enfraquecer as asserções.
- [x] Executar `node scripts/verify-alert-panel.mjs`, `pnpm --filter @predioon/building-web typecheck`, `pnpm --filter @predioon/building-web build`, `pnpm typecheck:e2e` e `pnpm check:boundaries`. Conferir capturas desktop/mobile e detalhes técnicos.
- [x] Revisar o diff, corrigir achados e registrar evidências. Revisão independente identificou o seletor ambíguo da mensagem duplicada em detalhes; corrigido para afirmar a visibilidade do registro autorizado. Nenhum outro achado importante.

## Entrega

Usar commit exclusivo dos arquivos desta alteração e push na main, seguindo a orientação permanente. Conferir a publicação pelo status Vercel do commit e pelo portal real. Evidências locais em `docs/evidencias/alert-panel-2026-10-26.json` e `docs/imagens/2026-10-26/`. Não incluir os arquivos de demonstração de outro trabalho já presentes no checkout.
