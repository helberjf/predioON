> Atualização posterior de07/11: o cenário obrigatório descrito como próximo nesta etapa já passou. Consulte o [resultado obrigatório e o pacote seguinte](../2026-11-07-browser-obrigatorio/RESULTADO.md). As notas abaixo preservam o estado da etapa V4.

# Resultado executado e revisado — V4

A única mudança de produto desde V3 é a chave do provedor de cerimônia: a tela anônima permanece montada ao aguardar o desafio MFA. Login concluído, logout e troca real de identidade continuam recriando o estado privado. Os três casos e suas expectativas são idênticos aos da tentativa V3 que reproduziu o defeito.

[Playwright com API/PostgreSQL reais](../../evidencias/mfa-real-browser-v4-2026-11-07.json): **3/3**, Chromium, um worker, zero retries/skips/falhas. Inscrição por senha/TOTP, retenção dos dez códigos até acknowledgment, erro de código, login por recuperação, reutilização recusada e desativação do gestor local passaram. Os dois casos de estrutura passaram, incluindo conflito, formulário intacto, desativação/reativação e filtro de inativos.

[Renderer separado](../../evidencias/mfa-browser-v4-renderer-2026-11-07.json): **4/4**, mesmos casos anteriores de retenção dos códigos, hints MFA, resposta atrasada e troca de identidade. Componentes reais; HTTP e primitivas de navegador sintéticos. O parser inicial esperava TAP, mas Node emitiu o formato spec; a conferência do log original confirmou quatro aprovações e saída0, sem repetir a execução. React19.2.3 do renderer difere do19.3.0 web.

Passaram tipos E2E e portal, seleção dos três testes e build de produção. Fonte/build foram conferidos antes/depois. API e PostgreSQL usaram ambiente isolado de teste; o banco descartável foi removido, seis papéis/credenciais/configurações restaurados, filhos diretos registrados encerrados e portas exclusivas fechadas. Não houve reinício.

[Restauração executada](../../evidencias/mfa-browser-v4-restore-2026-11-07.json): os **1.031 arquivos** são idênticos aos testados. Para retomar, restaure primeiro o checkpoint de85 payloads/1.028 arquivos e aplique este pacote V4 diretamente sobre ele, conforme [README](README.md). A V4 já inclui os cinco arquivos auxiliares V3 e acrescenta a correção de produto; não encadear V3→V4. O runtime publicado permanece001–067.

Foram revisadas três screenshots e três amostras de cada vídeo. [Imagens](../../imagens/2026-11-07/README.md) e [dois clipes de estrutura](../../videos/2026-11-07/README.md) acompanham o Git. O vídeo bruto de MFA mostra material de recuperação da fixture e fica privado. Esses clipes curtos não são as demonstrações completas solicitadas.

Ainda faltam o cenário UI obrigatório de ADMIN de plataforma, matriz completa e Codegen, demais comandos/domínios de MFA, regressão integrada, Android/iOS e aceites operacionais. O gestor local desta jornada tem MFA opcional: sua desativação204 não aprova desativação para ADMIN de plataforma. [Próximo cenário proposto](PROXIMO_CENARIO.md). Nenhuma aprovação de produção.
