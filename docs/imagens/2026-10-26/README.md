# Alertas do síndico — 26/10/2026

Capturas de Chromium geradas por `node scripts/verify-alert-panel.mjs`, usando o componente React real e respostas HTTP locais fictícias. Não representam sensores reais nem a produção.

- [Visão principal desktop](alertas-desktop.png)
- [Informações técnicas abertas](alertas-tecnico.png)
- [Visão mobile, 390 px](alertas-mobile.png)

O teste usa cinco tipos de demonstração e um alerta personalizado com situação desconhecida. O identificador longo da central verifica a quebra de texto no celular. A mensagem original, tipo, identificadores, gravidade, situação e datas permanecem no menu técnico fechado por padrão. A abertura foi conferida pelo teclado e pelo mouse, com as permissões originais preservadas.

[Resultado da verificação](../../evidencias/alert-panel-2026-10-26.json). Typecheck do portal e dos E2E, build Vite e fronteiras arquiteturais passaram. A suíte E2E com banco não foi executada nesta rodada: o Docker local está indisponível; as interações desta tela foram verificadas isoladamente com fixtures HTTP. O build conserva os avisos de tamanho do bundle e de comentários da dependência Zod.
