# Capturas reais de QA — 07/11/2026

## MFA obrigatória — administrador da plataforma

[Imagem final ativa](mfa-obrigatoria-administrador.png), [manifesto](manifesto-obrigatorio.json), [resultado e limites](../../continuidade/2026-11-07-browser-obrigatorio/RESULTADO.md). Um novo caso real passou, com flag legado e vínculo local; preservou os dez códigos após a tentativa proibida de desativação. Não exibe o valor dos códigos. A mídia foi copiada sem edição, em1280×800; vídeo bruto MFA privado.

## Versão corrigida V4 — três casos aprovados

[Manifesto das três novas imagens](manifesto-v4.json), [prova Playwright](../../evidencias/mfa-real-browser-v4-2026-11-07.json) e [clipes de QA](../../videos/2026-11-07/README.md). Mesmas condições1280×800/API real/PostgreSQL isolado; as capturas finais foram revisadas e copiadas sem edição.

- [MFA depois da jornada completa](mfa-jornada-corrigida.png): a imagem mostra o estado desativado ao final da desativação autorizada do gestor local. Inscrição, recuperação e recusa de código reutilizado passaram antes dela.
- [Edição de estrutura na V4](estrutura-edicao-v4.png).
- [Status de estrutura na V4](estrutura-status-v4.png).

As imagens das falhas anteriores permanecem abaixo com sua origem original. Nenhuma é captura nativa Android/iOS.

A [captura posterior V3](mfa-login-desafio-ausente.png), também revisada sem edição, registra o formulário vazio após uma resposta que exigiu MFA. SHA256: `44a57006bb11d958c0ab99b98ada282c5b122fc6b753fd260ab435f94b4b871a`. [Prova V3](../../evidencias/mfa-real-browser-v3-2026-11-07.json). A inscrição já havia passado; o login com recuperação ainda não passou nessa tentativa.

Três capturas de Chromium, 1280×800, revisadas visualmente e copiadas sem edição. [Manifesto com hashes](manifesto.json) e [resultado da rodada](../../evidencias/mfa-real-browser-v2-2026-11-07.json).

Portal Operação/Síndico compilado em produção, API real em modo teste e PostgreSQL descartável. Fonte candidata de 1.031 arquivos sobre o checkpoint MFA de 1.028; `main` observada `0817ae0`. A composição, incluindo testes auxiliares, é identificada pelo SHA do preparo no manifesto. Os usuários e condomínios são fictícios. A execução não altera o runtime publicado 001–067.

- [Edição de estrutura](estrutura-edicao.png): caso aprovado de blocos, unidades e equipes, incluindo formulário intacto sem envio e conflito que conserva o rascunho.
- [Status de estrutura](estrutura-status.png): caso aprovado de desativação/reativação e filtro de inativos. A imagem final mostra a lista filtrada depois de desativar a equipe.
- [MFA antes de corrigir a navegação do teste](mfa-painel-antes-da-correcao-do-teste.png): caso falhou antes da ativação. O teste esperava “Desativada” na página, mas a interface atual exige abrir “Gerenciar verificação”. Esta captura registra a falha, sem aprovar a jornada MFA.

Resultado desta tentativa: dois aprovados, uma falha, zero skips/retries. Banco temporário removido, seis papéis e configurações restaurados, portas exclusivas fechadas. Os vídeos brutos permanecem locais nesta publicação. Não há aceite da matriz completa, Android/iOS, carga ou produção.
