# Regressão real dos portais

Os testes usam Chromium, Firefox e WebKit, a API do projeto e os três servidores Vite. Cada cenário é executado nos três navegadores. Os percursos de domínio usam respostas reais; cenários específicos de indisponibilidade/concorrência interceptam falhas ou atrasam respostas para verificar recuperação. Não são ignorados quando falta infraestrutura: o processo falha com diagnóstico.

Prepare um PostgreSQL/TimescaleDB **isolado e descartável**, com bootstrap, todas as migrations, credenciais restritas e seed de demonstração. Por padrão, a suíte usa `localhost:5436/predioon`; as variáveis `DATABASE_URL_APP`, `DATABASE_URL_IDENTITY` e `DATABASE_URL_BROKER_AUTH` podem selecionar outro banco local de teste. A configuração rejeita endereços de banco remotos. A única exceção de rede é o serviço literal `postgres:5432/predioon` dentro do job GitHub, com `GITHUB_ACTIONS=true` e `E2E_DATABASE_SERVICE=postgres`; owner e runtime precisam selecionar o mesmo alvo. Não execute contra dados reais.

```powershell
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
```

Em runners Linux, use `pnpm exec playwright install --with-deps chromium firefox webkit`. Para investigar um navegador isoladamente, acrescente `--project=chromium`, `--project=firefox` ou `--project=webkit` ao comando de testes. As contas são `sindico@predioon.local`, `morador@predioon.local` e `admin@predioon.local`; a senha acompanha `SEED_PASSWORD`, com o padrão de demonstração `predioon123`.

A configuração inicia a API na porta 3100 e os portais nas portas 5273–5275. `E2E_PORT_OFFSET` aceita um inteiro de 0 a 9999 e desloca as quatro portas e as pastas de resultado para execuções locais independentes; cada execução também precisa de seu próprio banco. Servidores existentes não são reutilizados. O serviço de ingestão não é necessário para estes testes: o dashboard pode mostrar ausência de telemetria, sem inventar leituras.

Os cenários cobrem:

- Login real e inválido, validação HTML, dashboard, contas sem condomínio e recuperação do painel administrativo.
- Cookie HttpOnly e SameSite, access somente em memória, limpeza dos tokens legados e SSE com bearer no cabeçalho, sem credencial na URL.
- Restauração após reload, renovação simultânea em duas abas, propagação de logout/troca de conta, sessões independentes entre portais e revogação real de família.
- Logout sem rede permanece bloqueado após reload; login inválido não recupera a identidade antiga; ausência de Web Locks apresenta diagnóstico sem enviar autenticação.
- Proteção CSRF real para cabeçalho ausente, formulário e origem não permitida; cookie isolado não autentica rotas de domínio.
- Criação e persistência de bloco/unidade/equipe/integrante, diretório de pessoas e administrador autorizado exclusivamente por RBAC.
- Troca de condomínio com descarte de rascunhos, persistência da escolha e separação dos registros.
- Concessão e revogação de papel com confirmação cancelável, verificação das capacidades no servidor e formulários ocultos para moradores.
- Publicação, edição, agendamento e remoção de avisos; moradores recebem apenas publicados e a API nega consulta privada e escrita.
- Chamado em tela de 390 px: criação, conversa, andamento pela gestão, cancelamento e privacidade entre moradores.
- Reserva em tela de 390 px: solicitação, aprovação pela gestão, cancelamento e persistência após recarregar.
- Mudança real da exigência de aprovação enquanto o formulário está aberto: mensagem e situação refletem a resposta atual do servidor.
- Calendário diário sem dados pessoais, conflito real de horário e atualização após cancelamento para permitir uma nova reserva.
- Dashboard com contagem de chamados próprios, do condomínio e do recurso autorizado; ausência de permissão e pausa não aparecem como zero, e o resumo nunca inclui o conteúdo privado dos relatos.
- Contas com rascunho privado, edição, publicação dos totais e correção que preserva a publicação anterior; morador não recebe ações de gestão.
- Gestão financeira limitada ao relatório selecionado, separada da consulta de outro relatório; revogar leitura ou gestão desmonta o editor e descarta o rascunho local, sem conceder criação no condomínio.
- Regras de alerta com leitura/gestão próprias, concessões exatas por regra ou equipamento, criação sem acesso ao inventário e remoção dos controles após revogação; configurar equipamentos não concede gestão de regras.
- Logout com revogação no servidor, histórico do navegador e nova identidade sem formulários da sessão anterior.

Cada cenário usa `test` de `e2e/fixtures.ts`. A preparação SQL no banco descartável cria três identidades exclusivas a partir das contas demonstrativas, conservando nomes, senha de demonstração, vínculos e escopos diretos. `demoAccountEmail` resolve os aliases somente durante esse cenário; a limpeza remove apenas seus três IDs. Isso separa sessões e o orçamento de tentativas de login entre cenários e navegadores. Não altera, apaga nem contorna o limitador: todo login correto ou inválido continua chegando à API real. Os logins manuais de cenários de erro também usam o alias correspondente.

As fixtures de domínio criam prédios, pessoas e vínculos pela API autenticada, usando as mesmas políticas de acesso do produto. A conta da plataforma cria o cadastro inicial; a conta do condomínio faz as operações. Os registros recebem nomes únicos e permanecem somente no banco descartável; a suíte não reseta o banco nem apaga registros de outros testes. Os casos que removem avisos ou revogam vínculos atuam apenas sobre registros criados pelo próprio cenário.

Os cenários de contador e finanças com escopo exato criam papéis exclusivos e seus vínculos por SQL, pois a API pública aceita apenas os papéis padrão no condomínio inteiro. Para eles, `DATABASE_URL` precisa apontar para a conexão owner do mesmo banco e porta locais de `DATABASE_URL_APP` (padrão `postgres://predioon:predioon@localhost:5436/predioon`). O helper valida protocolo PostgreSQL, loopback, banco e porta antes de abrir cada pool independente, limitado a uma conexão. Os cenários removem exatamente seus papéis/vínculos em `finally`, e o helper fecha o pool mesmo em falha; nenhuma permissão de papel padrão é alterada. As consultas e a renderização verificadas continuam usando a API real com credenciais restritas.

Relatório HTML, capturas e traces de falhas ficam em `.local/playwright-report` e `.local/playwright-results`, ignorados pelo Git. As gravações podem conter sessões das contas de demonstração; use apenas o banco descartável preparado para a suíte.

## Ambiente do CI e regressão de atualização

O workflow usa a [imagem oficial Playwright](https://playwright.dev/docs/ci#via-containers) `1.63.0-noble`, na mesma versão fixada do pacote. Os navegadores e dependências do sistema já vêm na imagem. O [PostgreSQL do job container](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers) é acessado pelo nome do serviço; não precisa publicar porta no host.

Nos runs `f622949` e `ccac601`, seis traces WebKit registraram `Network process crashed`, abortando consultas e perdendo o cookie. Uma sétima falha ficou presa no reload sem causa demonstrada. A imagem fixa padroniza o ambiente; sua eficácia depende da próxima execução do CI, sem retries adicionais ou expectativas enfraquecidas.

A falha Firefox de revogação teve causa diferente e foi reproduzida: `useResource` descartava Atualizar durante uma consulta pendente. O teste de gestão pontual segura respostas reais anteriores à revogação, solicita nova atualização e só então as libera. A correção preserva no máximo uma atualização seguinte, sem cancelar consultas lentas nem reutilizar dados de outro escopo. RED e relatórios dirigidos ficam em `.local`, separados dos artefatos dos runs originais.

Validação local deste recorte: **71/72** no lote de recursos, isolamento, cookies e sessões; o caso restante aguardava apenas os cabeçalhos do comentário antes de clicar em outra mutação. Passou a esperar a resposta visível no histórico, preservando os asserts de cancelamento. A repetição dos quatro cenários de recursos nos três motores passou **12/12**, também pela rede de serviço `postgres:5432` da nova configuração. Resultado composto: 60 cenários não alterados aprovados no lote original +12 recursos aprovados no lote final, sem alegar uma execução única de72 inteiramente verde. Passaram também73 testes UI, três testes da guarda de banco, tipos UI/E2E e parsing do YAML/versão da imagem. A API desses ensaios permaneceu no snapshot033, separada das mudanças034/035 em curso.
