# Capturas reais de QA — 07/11/2026

Três capturas de Chromium, 1280×800, revisadas visualmente e copiadas sem edição. [Manifesto com hashes](manifesto.json) e [resultado da rodada](../../evidencias/mfa-real-browser-v2-2026-11-07.json).

Portal Operação/Síndico compilado em produção, API real em modo teste e PostgreSQL descartável. Fonte candidata de 1.031 arquivos sobre o checkpoint MFA de 1.028; `main` observada `0817ae0`. A composição, incluindo testes auxiliares, é identificada pelo SHA do preparo no manifesto. Os usuários e condomínios são fictícios. A execução não altera o runtime publicado 001–067.

- [Edição de estrutura](estrutura-edicao.png): caso aprovado de blocos, unidades e equipes, incluindo formulário intacto sem envio e conflito que conserva o rascunho.
- [Status de estrutura](estrutura-status.png): caso aprovado de desativação/reativação e filtro de inativos. A imagem final mostra a lista filtrada depois de desativar a equipe.
- [MFA antes de corrigir a navegação do teste](mfa-painel-antes-da-correcao-do-teste.png): caso falhou antes da ativação. O teste esperava “Desativada” na página, mas a interface atual exige abrir “Gerenciar verificação”. Esta captura registra a falha, sem aprovar a jornada MFA.

Resultado desta tentativa: dois aprovados, uma falha, zero skips/retries. Banco temporário removido, seis papéis e configurações restaurados, portas exclusivas fechadas. Os vídeos brutos permanecem locais nesta publicação. Não há aceite da matriz completa, Android/iOS, carga ou produção.
