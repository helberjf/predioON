# Regressão real dos portais

Os testes usam Chromium, Firefox e WebKit, a API do projeto e os bundles de produção dos três portais. A configuração compila cada portal e serve o resultado com `vite preview` em loopback; `VITE_API_URL` é definido antes do build. Assim a matriz verifica os arquivos que serão distribuídos, sem o cliente de atualização HMR do desenvolvimento. Cada cenário é executado nos três navegadores. Os percursos de domínio usam respostas reais; cenários específicos de indisponibilidade/concorrência interceptam falhas ou atrasam respostas para verificar recuperação. Não são ignorados quando falta infraestrutura: o processo falha com diagnóstico.

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

O container executa com UID 1001, conforme o exemplo oficial para GitHub Actions, para coincidir com o proprietário do diretório do runner. Em `7aed410`, os 51 cenários Firefox falharam antes da navegação porque o processo root não podia usar esse diretório. A mudança de UID em `983b996` permitiu aprovar todos os cenários Firefox no CI; Chromium também passou. Os três casos restantes daquela matriz eram WebKit, investigados separadamente.

Após isolar as identidades de login em `5eda20e`, a matriz local Linux passou **153/153**, sem retries, com API e banco reais até SQL 035, em 15min30s. Antes dela, os 57 dirigidos de cookies, isolamento e portais também passaram. O snapshot não inclui a evolução posterior do AccessPanel nem a auditoria 036; a falha do ambiente Firefox do CI não é uma falha dessas 153 execuções locais.

Nos runs `f622949` e `ccac601`, seis traces WebKit registraram `Network process crashed`, abortando consultas e perdendo o cookie. Uma sétima falha ficou presa no reload sem causa demonstrada. A imagem fixa padronizou o ambiente, mas não eliminou os crashes: o CI de `aec9f41` passou170/174; o de `b4726b9` passou172/174. Os dois traces desta última rodada também contêm `Network process crashed`, seguido de requisições abortadas e perda da sessão. Não foi atribuída uma causa definitiva ao processo nativo.

Com os bundles de produção, a matriz local Linux após o AccessPanel passou **174/174**, em 22min30s, com API e PostgreSQL reais até035, um worker e zero retries. A fonte de produto corresponde à publicada até `b4726b9`; a configuração passa a compilar antes de servir. Tipos da configuração aprovados. Log local: work/browser035-preview-all.log. O resultado inclui as58 combinações por navegador e não contém os rascunhos036. É uma execução completa própria, sem somar resultados anteriores.

O [CI de80c9798](https://github.com/helberjf/predioON/actions/runs/37024663752) confirmou **174/174**, em9,7min, um worker e zero retries, usando a nova configuração. O log foi preservado em work/browser-ci-80c9798.log. A matriz publicada passou por inteiro; esse sucesso não estabelece sozinho a causa interna dos crashes nativos anteriores. A implantação por Caddy permanece coberta pelos testes específicos de imagens/proxy.

A falha Firefox de revogação teve causa diferente e foi reproduzida: `useResource` descartava Atualizar durante uma consulta pendente. O teste de gestão pontual segura respostas reais anteriores à revogação, solicita nova atualização e só então as libera. A correção preserva no máximo uma atualização seguinte, sem cancelar consultas lentas nem reutilizar dados de outro escopo. RED e relatórios dirigidos ficam em `.local`, separados dos artefatos dos runs originais.

## Auditoria036

`audit.spec.ts` acrescenta cinco cenários por motor: histórico global com DTO mínimo; paginação local com timestamps iguais; concessão exata, revogação e vazio autorizado; falha/retry e troca de condomínio; troca de conta no mesmo documento com resposta antiga retida. As contas, condomínios e grants têm IDs exclusivos e são removidos em `finally`. As consultas/renderização usam API eRLS reais. Somente fixtures específicas de grants e histórico sintético são inseridas pelo owner do banco descartável; papéis padrão não são alterados.

O harness das respostas atrasadas consome um clone do corpo real e confere o resourceId antigo antes de verificar que ele não apareceu no novo escopo. Isso evita aguardar um stream que o cliente corretamente abandonou por mudança de identidade. Não cancela a resposta atrasada nem substitui seu conteúdo por uma resposta simulada. A falha503 é o único corpo injetado nesses casos de recuperação.

Em03/10, os dirigidos passaram **15/15**. A matriz integral posterior passou **189/189**,63 por motor, sem retries, um worker, bundles dos três portais e API/PostgreSQL reais até036, em26 minutos. Log local: work/audit036-web-full.log; relatórios/capturas ficaram em work/audit036-web-full-results e work/audit036-web-full-report. São duas execuções próprias; a integral não é a soma da matriz anterior com os novos dirigidos. A aprovação do CI precisa ser conferida no commit publicado.

Depois dessa integral, a apresentação de atorUSER sem userId foi corrigida para Conta não identificada; ela não pode afirmar que a ação veio do Sistema. A expectativa foi acrescentada ao cenário global e os cinco casos passaram novamente **15/15**, nos três motores, em1 minuto; tipos UI/E2E aprovados. Log work/audit036-actor-label.log. Essa é a validação dirigida da mudança posterior, não uma nova integral de189.

Validação local deste recorte: **71/72** no lote de recursos, isolamento, cookies e sessões; o caso restante aguardava apenas os cabeçalhos do comentário antes de clicar em outra mutação. Passou a esperar a resposta visível no histórico, preservando os asserts de cancelamento. A repetição dos quatro cenários de recursos nos três motores passou **12/12**, também pela rede de serviço `postgres:5432` da nova configuração. Resultado composto: 60 cenários não alterados aprovados no lote original +12 recursos aprovados no lote final, sem alegar uma execução única de72 inteiramente verde. Passaram também73 testes UI, três testes da guarda de banco, tipos UI/E2E e parsing do YAML/versão da imagem. A API desses ensaios permaneceu no snapshot033, separada das mudanças034/035 em curso.
