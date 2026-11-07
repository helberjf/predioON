> Atualização posterior de07/11: o cenário obrigatório descrito como próximo nesta etapa já passou. Consulte o [resultado obrigatório e o pacote seguinte](../2026-11-07-browser-obrigatorio/RESULTADO.md). As notas abaixo preservam o estado da etapa V4.

# Próximo cenário de MFA obrigatório

Nota de autoria preservada abaixo. Atualização de root: os três casos V4 já passaram após corrigir o desafio de login; a proposta ADMIN abaixo continua não implementada/não executada. Use a V4 como fonte de partida e preserve o cenário opcional separado.

# Proposta de QA UI para MFA obrigatório de plataforma

Estado: leitura estática em 2026-11-07; nenhum teste extra foi escrito ou executado. Completar os três casos V3 atuais primeiro. Esta proposta não modifica a política nem transforma o gestor local opcional em administrador de plataforma.

## Diagnóstico da falha V2

O snapshot real da falha mostra o botão **Gerenciar verificação** na página de sessões. O painel deixou de ser inline e agora pertence ao diálogo central. A linha13 antiga esperava Desativada antes de abrir esse diálogo. SessionsPanel, MfaCeremonyHost e MfaCeremonyProvider confirmam esse contrato; o acknowledgment fecha o diálogo.

O gestor criado por isolatedTenant recebe apenas membership BUILDING_ADMIN e continua not-required. A função infrastructure/068-platform-mfa-required.sql identity_platform_mfa_required exige usuário ativo com is_platform_admin ou binding PLATFORM_ADMIN global efetivo. A rota de disable recusa somente essa exigência de plataforma. Portanto, o cenário opcional preserva disable204; atribuir obrigatoriedade ao gestor seria alterar indevidamente o oráculo.

Overlay V3 congelado: e2e/specs/auth/mfa.spec.ts SHA256 ab261dd3ca39153fe0035bfea01e2bfcb1f54b958522199faba084b62bf902f9. Todas as linhas originais permanecem em ordem, acrescidas de navegação e assertions do diálogo/hold/ack. Seu resultado permanece pendente nesta nota.

## Setup viável com HTTP real

1. Usar a fixture automática existente para obter o ADMIN alias isolado. Chamar adminFixtures uma vez: o helper faz login com senha real, enroll, confirmação TOTP e verifica satisfied no mesmo bearer/SID. Esse ator é apenas o preparador.
2. Pelo api desse preparador, criar um condomínio isolado e uma segunda conta por POST /users com nome/e-mail aleatórios, senha de demonstração e isPlatformAdmin:true. O schema real permite esse campo e a rota exige rbac:manage e verificação recente. Conferir201 e o flag verdadeiro retornado.
3. Criar POST /users/memberships para a nova conta e condomínio, role BUILDING_ADMIN. Conferir201. A conta nova é o ator UI obrigatório; ainda não possui fator. Não usar o ADMIN preparador como ator UI, pois já foi inscrito.
4. Acessar building-web e autenticar essa nova conta pelo formulário. Observar a resposta real /auth/web/login, mantendo accessToken apenas em memória para assertions HTTP na mesma família. Conferir usuário esperado, PLATFORM_ADMIN, enrollment-required e memberships ocultas antes da prova. Não realizar segundo login, trocar SID, gravar fator/prova SQL ou adulterar storage/cookies.

A criação/associação do ator é inteiramente por rotas reais. O owner SQL permanece limitado à infraestrutura existente de aliases/fixture descartável e limpeza; nunca produz o fator ou a prova de MFA. Usuários/condomínios criados por rotas são eliminados ao remover o banco UUID oficial após o encerramento dos consumidores, como ocorre nos cenários atuais.

## Oráculo recomendado

- Antes do login, observar requisições de página aos endpoints dos providers privados (/buildings e os caminhos efetivamente usados por FeatureProvider/BuildingAccessProvider). Registrar apenas caminhos/contagens, nunca headers/tokens. Não interceptar nem responder artificialmente.
- Confirmar o gate acessível **Verificação obrigatória da sessão**, ausência do Menu principal e abertura do diálogo de enrollment. Antes da confirmação e enquanto os códigos aguardam acknowledgment, nenhum provider privado deve montar/fazer requisições observadas. Esse é um contrato observável delimitado; não alegar inspeção de todos os providers apenas por ausência visual.
- Pelo mesmo bearer retornado no login UI, uma leitura protegida antes do enrollment deve recusar403 com MFA_ENROLLMENT_REQUIRED. Os preparativos do ADMIN separado não contam como requisições do ator UI.
- Preencher senha e TOTP reais no diálogo. Esperar a lista ter exatamente10 itens antes de ler seu conteúdo. Conferir códigos visíveis, Fechar desabilitado e Escape incapaz de fechar, gate mantido e ausência dos requests privados até acknowledgment.
- Armar observação de /buildings200 antes de clicar Já guardei os códigos. Depois do acknowledgment, conferir diálogo fechado, códigos ausentes do DOM, /auth/me satisfied no mesmo bearer, memberships recuperadas e navegação operacional. Se houver mais de um condomínio, selecionar o condomínio da fixture pela UI; o flag global pode descobrir outros condomínios do banco descartável.
- Em Minhas sessões > Gerenciar verificação, conferir Ativada, mensagem de obrigatoriedade e ausência de Desativar verificação.
- Fazer POST /auth/mfa/disable com senha correta e um código de recuperação ainda não usado, usando exatamente o bearer do login UI. Esperar403 reason MFA_REQUIRED. Conferir /auth/mfa ainda enabled,10 códigos restantes e /auth/me satisfied. A negativa não deve consumir código nem remover fator/prova.
- Preservar separadamente o caso opcional V3 com senha errada, código inválido, login por recuperação, reutilização negada, disable204 e login sem código depois de desativar. O novo caso não o substitui.

## Limites de execução e publicação

O lote atual continua três casos/duas specs, um Chromium, um worker e zero retries. Acrescentar este cenário exige nova composição/pins, seleção explícita, contagens do controller e prova atualizadas; não acrescentá-lo silenciosamente ao contrato3. Os arquivos de produto/helper permanecem preservados.

Usar o mesmo backend real, fixture UUID oficial, APIs restritas, portas loopback e guard2048, com execução serial e cleanup após filhos diretos registrados/portas fechadas. Capturas, relatórios, tokens em memória e códigos da cerimônia permanecem privados até revisão de mídia. A proposta não demonstra Android/iOS, todos os fluxos, carga ou prontidão de produção.

Fontes examinadas: apps/api/src/modules/users/routes.ts; apps/api/src/auth/web-routes.ts; apps/api/src/auth/mfa.ts; infrastructure/068-platform-mfa-required.sql; apps/building-web/src/App.tsx; packages/ui/src/components/{mfa-session-gate,mfa-ceremony-host,mfa-panel,sessions-panel}.tsx; packages/ui/src/mfa-ceremony.tsx; e2e/support/{fixtures,helpers}.ts.

Nota futura do caso opcional: o allTextContents original le os codigos imediatamente apos observar a resposta HTTP. Um wait toHaveCount(10) antes da leitura pode tornar esse ponto mais robusto; nenhuma falha por essa corrida foi observada ate esta autoria. Nao alterar o overlay V3 congelado antes de concluir sua execucao.
