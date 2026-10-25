# Entrada pública — 24/10/2026

Capturas reais de Chromium sem sessão, servindo o build de produção do portal do morador com `vite preview` em loopback. Os componentes são compartilhados pelos três portais. Fonte da interface pública: [`78c62935`](https://github.com/helberjf/predioON/commit/78c6293545284dc5864249e4cd71116558989f01), baseado em `c53117d6`. A captura não usa dados de condomínio nem comprova fluxos autenticados.

- `entrada-mobile.png`: 390 × 844, página `/`, capturada durante a gravação Codegen.
- `apresentacao-desktop.png`: 1440 × 1000, início de `/conheca`.

As duas imagens foram abertas e conferidas visualmente. Os cenários de navegação, layout e acessibilidade ficam em `e2e/specs/public/platform-presentation.spec.ts`.

| Arquivo | SHA-256 |
|---|---|
| entrada-mobile.png | dcff1450daca4a4175727c75c92654502afa967a87eedca5746739d9cbbbdc86 |
| apresentacao-desktop.png | 8d38e6e801ea948a02b1c2bdb01d0ecdb85d2fbb93365f6c7d5e49652ab2e670 |

## Apresentação própria do morador

Fonte: [`11756be1`](https://github.com/helberjf/predioON/commit/11756be12c09f3c483d2fc8fb4b2b603b41b3d4f). Build de produção do portal do morador em Chromium, sem sessão, servido em loopback. A entrada, a apresentação e seus recursos foram conferidos visualmente. O percurso foi gravado novamente com Codegen, incluindo login e convite. A ilustração de celular é HTML estático identificado como exemplo, sem dados reais.

| Arquivo | Dimensões | SHA-256 |
|---|---|---|
| morador-entrada-mobile.png | 390 × 844 | 9d1e045aa3257eac0a7f3187a06645a74d0b56e9cbe99cbb0798b86398b6ab01 |
| morador-apresentacao-mobile.png | 390 × 844 | 46a3d038300275e3ad942f5166de4f1b5893e448fe0029174faed8a6d93fc487 |
| morador-apresentacao-desktop.png | 1440 × 1000 | 805d7dae6ddfa63f7f96c6c35effc7d97ee8b0a2ef8696de10642ce44c006252 |
