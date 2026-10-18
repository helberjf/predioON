# Vídeos de demonstração

Gravados em 18/10/2026 neste computador, com **dados fictícios**: banco descartável novo, só com o seed de demonstração ("Condomínio Piloto") e quatro dias de leituras geradas pelo `demo:data` da ingestão, que passa pelo pipeline real. Nenhum hardware foi acionado e nenhuma instalação existente foi usada; a demonstração 037 não foi tocada.

| Vídeo | Conteúdo | Duração |
| --- | --- | --- |
| [01-portal-administracao.mp4](01-portal-administracao.mp4) | Portal da administração: visão geral e saúde dos serviços, condomínios, clientes, comunicação, equipamentos, funcionalidades, usuários, acesso de suporte, auditoria e sessões | 1 min 16 s |
| [02-portal-sindico.mp4](02-portal-sindico.mp4) | Portal do síndico: água e reservatórios, energia e fases, consumo, alertas, ocorrências, avisos, áreas comuns, ordens de serviço, ativos, automações (por alerta e programadas), unidades e equipes, transparência, acesso de suporte | 1 min 43 s |
| [03-portal-morador.mp4](03-portal-morador.mp4) | Portal do morador (tela de celular): avisos, ocorrências, reservas, transparência, perfil e sessões | 45 s |
| [04-app-morador.mp4](04-app-morador.mp4) | App Morador no emulador Android: entrada com "Tenho um convite", escolha do condomínio, avisos, solicitações, reservas, transparência e acessos | 2 min 49 s |
| [05-app-operacao.mp4](05-app-operacao.mp4) | App Operação no emulador Android: resumo, alertas, sensores com leituras atuais e ordens de serviço | 2 min 12 s |

**Como foram gravados:** os portais com `scripts/record-portal-videos.mjs` (Playwright, Chromium, legenda em cada passo), iniciados por `pnpm exec playwright test -c playwright.videos.config.ts`; os apps com `scripts/record-app-video.py` (UI Automator e `adb screenrecord`), build debug x86_64 e Metro, emulador Pixel com Android 15. O consumo não aparece no portal e no app do morador porque a conta de demonstração não tem medidor liberado pelo síndico (regra da 051).

**Achados durante a gravação:**

- No app Operação, as leituras dos sensores e o último contato do gateway apareciam como "Data indisponível": duas rotas em SQL bruto (`/telemetry/latest` e `/overview/building`) devolviam o horário no formato de texto do PostgreSQL, que o Hermes não interpreta. Corrigido com o mesmo formatador ISO das ordens de serviço; teste próprio. O vídeo 05 já mostra as datas.
- O `demo:data` não terminava depois de gerar o histórico, porque o pool restrito da ingestão (052) ficava aberto. Corrigido.
- O logcat das quatro execuções nos apps (duas por app) não registrou nenhum aviso `MissingViewState` do renderer Fabric. Isso não prova a ausência dos avisos vistos no CI em outubro, mas eles não se repetiram neste percurso.
