# Continuidade da integração MFA — 04/11/2026

Este checkpoint preserva **47 arquivos recuperáveis: cinco já publicados e 42 candidatos**. A API publicada continua com migrations **001–067**. A MFA administrativa obrigatória ainda depende da integração e dos testes abaixo; não aplicar os patches ao ambiente de produção.

## Conteúdo e provas

| Patch | Arquivos | Estado |
| --- | --- | --- |
| [transport-publicado.patch](transport-publicado.patch) | Quatro fontes do cliente/coordenação e um arquivo de testes | Publicado em `9e79bde`: 25 testes dirigidos, 118 originais e tipos do cliente aprovados |
| [backend.patch](backend.patch) | 15 fontes de API/contratos/DB e um arquivo de testes | Candidato: sete testes puros aprovados; tipos sem resultado por timeout |
| [consumidores.patch](consumidores.patch) | 24 arquivos web/mobile | Candidato V5: 19 testes puros aprovados e revisão estática; integração pendente |
| [testes-banco.patch](testes-banco.patch) | Dois arquivos com nove casos API/PostgreSQL | Nenhum dos nove casos executado |

O [manifesto](MANIFESTO.json) registra a base `b259f80b158aff08f255a83f9d8ae551289d5fcf`, hashes antes/depois, componentes e hashes dos quatro patches. Eles são disjuntos. A restauração dos bytes dos 47 arquivos foi conferida em diretório externo; não foi uma execução nem uma restauração completa do projeto. `publishedFiles` identifica os cinco caminhos já incorporados; `draftFiles` conta somente os 42 pendentes.

## Como retomar em outro computador

1. Ler [CONTINUIDADE.md](../../CONTINUIDADE.md), a [retomada](../../RETOMADA_2026-11-03.md) e a [corrigenda da política](../../superpowers/plans/2026-11-04-platform-admin-mfa-policy-refinement.md). Clonar o repositório e comparar a main atual antes de integrar qualquer rascunho.
2. Copiar os quatro patches e o manifesto para fora do checkout. Para reconstruir este conjunto exato, criar uma cópia isolada da base `b259f80b158aff08f255a83f9d8ae551289d5fcf`; conferir os hashes anteriores, executar `git apply --check` em cada patch, aplicar e conferir os hashes posteriores. O código da base sem os patches não contém todos estes candidatos.
3. Não reaplicar `transport-publicado.patch` na main que já contém `9e79bde`. O backend é cumulativo: não aplicar também o antigo `prova-por-familia.patch`. Para uma main posterior, revisar as diferenças e integrar os componentes pendentes sem sobrepor alterações novas.
4. Para observar as nove negativas esperadas na API original 067, aplicar **somente `testes-banco.patch`** na base isolada, sem os outros três. Executar com a fixture oficial em banco UUID exclusivo. Nenhum RED desses nove casos foi observado até este checkpoint.
5. A [migration 068 candidata e o mapa SQL](../2026-11-04-mfa-candidato/README.md) continuam documentais e incompletos. Concluir e revisar a fronteira SQL antes de ensaiar a implementação; nunca reaplicar migrations 001–067 nem seed/reset em instalação existente.

Os launchers locais antigos congelam toda a árvore da base b259. Como cinco caminhos do cliente mudaram, conferir novamente a fonte e a resolução das dependências na cópia isolada; não reduzir guards para contornar divergências. Em outra máquina, criar identidade e credenciais próprias para o cluster de testes, sem reutilizar as desta sessão.

## Comportamento e limites

O [cliente publicado](../../evidencias/mfa-client-transport-2026-11-04.json) reconhece somente os motivos MFA explícitos no 403. Separa mudança de identidade de mudança de autorização: descarta respostas privadas antigas e preserva os resultados válidos de confirmação, códigos e rotação da mesma família. Nova identidade/logout continuam invalidando respostas antigas. Não há repetição automática de comandos negados por MFA. A troca de senha já confirmada em 204 conserva a limpeza local da sessão. Esses ajustes preparam o cliente; a API atual ainda não entrega a política obrigatória.

O [backend candidato](../../evidencias/mfa-http-candidate-2026-11-04.json) inclui prova por família, estado MFA por sessão, contexto, bootstrap em uma consulta, gate HTTP com exceções explícitas e mapeamento PMF01/02. As cinco emissões SSE ocorrem depois de a transação terminar. Seus sete testes verificam funções puras de política/erros, sem HTTP, SSE ou PostgreSQL.

A checagem de tipos dessas 15 fontes terminou em **ETIMEDOUT/SIGTERM, sem saída nem resultado do compilador**. O prazo configurado era 300 segundos; a duração observada foi 1066 segundos, sem causa estabelecida para essa diferença. Não é PASS nem diagnóstico confirmado de erro de código. Fontes e overlays foram preservados e não ficou processo próprio ativo. A compilação antiga de quatro arquivos não aprova este conjunto.

Nos [consumidores V5](../../evidencias/mfa-consumer-candidate-2026-11-04.json), a cerimônia MFA tem um único painel acima das telas privadas. Mudanças de autorização conservam a confirmação e os códigos em memória; logout/nova identidade os descartam. O app substitui o conjunto de comandos invalidado, exigindo novo gesto explícito. A releitura do perfil bloqueia a reconexão SSE quando a sessão se torna restrita, inclusive em resposta 200. Os 19 testes puros passaram em 492,4401 ms, sem falhas/skips/cancelamentos, com 44 fontes isoladas conferidas. A revisão estática aprovou a preservação do candidato; não houve React renderizado, tipos V5, navegador, backend real, build ou aparelho.

`MFA_PORTAL_URL` está vazio por padrão e precisa receber a origem HTTPS real na implantação. O candidato direciona o cadastro ao portal; a prova da família web não libera a família nativa. O app exige novo login com senha e código. Versões V3/V4 e manifests anteriores permanecem históricos; suas contagens não são somadas à V5.

## Trabalho ainda necessário

1. Completar guards SQL no mesmo snapshot que concede acesso: devices, organizações, projeções globais, suporte e respostas vazias. A 068 documental cobre somente três políticas; pre/post-checks separados não fecham as corridas de promoção.
2. Revisar mutadores e funções privilegiadas, expiração durante espera por locks, readback de prova após triggers e promoção durante desativação do fator.
3. Executar os nove casos dirigidos com fixture oficial, classificar RED/GREEN reais e validar SQL/ACL, HTTP/SSE e fixtures. Repetir tipos do conjunto apenas quando houver recursos para obter resultado.
4. Integrar consumidores e testar a cerimônia renderizada, confirmação dos códigos, ciclos de AppState, reconexão, regressões e Playwright com backend real. Depois conferir builds e jornadas Android/iOS em aparelhos.
5. Regularizar o [bloqueio de CI observado](../../evidencias/ci-account-blocker-2026-11-04.json), validar execução nova da fonte exata e concluir aceite operacional, documentação final e cinco vídeos atuais.

Reservar cerca de 4 GB livres antes de iniciar o banco; manter guard de 1536 MiB após readiness e antes de cada processo. A matriz integral de navegador exige 4096 MiB. Não reduzir esses limites, fechar aplicativos desconhecidos ou reiniciar computador, Docker ou WSL. Os cinco vídeos existentes são de 18/10 e não demonstram esta integração.
