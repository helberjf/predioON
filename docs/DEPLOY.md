# Instalação — Prédio ON

Este roteiro sobe seis serviços permanentes: PostgreSQL/TimescaleDB, API, EMQX, ingestão, worker de notificações e Caddy com os três portais. Um sétimo serviço, `db-admin`, existe somente para comandos administrativos transitórios. A release contém migrations versionadas até 058, credenciais restritas por serviço e RLS. Uma VPS única não oferece alta disponibilidade contra perda do host.

O roteiro completo, com resumo inicial, instalação de campo, primeira conta administrativa, operação e aceite, está no [manual de implantação em condomínio](IMPLANTACAO_CONDOMINIO.md). Este arquivo detalha a infraestrutura.

O contrato de campo está em [ENTREGA_HELBER.md](ENTREGA_HELBER.md). Este guia não publica uma instalação automaticamente: domínio, DNS, certificados MQTT, acesso à VPS e backups pertencem à operação.

## Preparar a VPS

Use uma distribuição Linux suportada pelo Docker, por exemplo Ubuntu 24.04 LTS, com SSH por chave, Git, curl e OpenSSL. Para um piloto, reserve inicialmente 2 vCPU, 4 GiB de RAM e 40 GiB SSD; ajuste após medir build, retenção e volume real de telemetria. Não é um limite de capacidade validado.

Instale Docker Engine e o plugin Compose V2 pelo [repositório oficial do Docker para Ubuntu](https://docs.docker.com/engine/install/ubuntu/). Use uma versão com `up --wait` e `--wait-timeout`. Verifique o daemon e habilite seu início com o sistema:

```bash
docker version
docker compose version
sudo systemctl enable --now docker
git clone --branch main https://github.com/helberjf/predioON.git
cd predioON
git rev-parse HEAD
```

Execute os comandos Docker com um usuário autorizado no host. Mantenha uma única cópia do projeto para a instalação; o nome Compose padrão é `predioon`. Para outra instalação, defina `COMPOSE_PROJECT_NAME` consistentemente e escolha outras portas/rede. O PostgreSQL e o dashboard EMQX não publicam portas no host.

No firewall da nuvem/host, permita SSH apenas das redes administrativas e TCP 80/443 para web, TCP 8883 para gateways. Preserve a regra de SSH antes de ativar um firewall. As portas publicadas pelo Docker precisam ser controladas também no firewall do provedor ou nas regras compatíveis com Docker; consulte [Docker e filtragem de pacotes](https://docs.docker.com/engine/network/packet-filtering-firewalls/).

Os volumes nomeados persistem banco, sessão MQTT e estado ACME. Cada serviço usa o driver de logs `local`, com rotação de até três arquivos de 10 MiB. Nunca execute `down -v` na instalação para atualizar.

## Domínio e segredos

1. Instalar Docker e Compose na VPS.
2. Apontar `api`, `admin`, `sindico`, `morador` e `mqtt` do domínio para a VPS.
3. Liberar 80/443 para os painéis e 8883 para os gateways.
4. Gerar `infrastructure/.env.prod` a partir do exemplo com senhas exclusivas, chave MFA e um par Ed25519 persistente. O gerador usa somente Node da imagem Docker, cria o arquivo com permissão 600 e recusa sobrescrever um destino existente:

```bash
docker run --rm --user "$(id -u):$(id -g)" \
  --mount "type=bind,source=$PWD,target=/workspace" -w /workspace \
  node:24-slim node infrastructure/generate-prod-env.mjs
chmod 600 infrastructure/.env.prod
# Edite DOMAIN, ACME_EMAIL, MQTT_CERTS_DIR e as integrações opcionais.
nano infrastructure/.env.prod
```

Sem o gerador, copie o exemplo e preencha todas as chaves obrigatórias. Use sete senhas de banco distintas, com pelo menos 32 caracteres base64url (por exemplo, `openssl rand -hex 32` para cada senha). A API recebe somente seus três logins; ingestão recebe `predioon_ingest` e `predioon_access_service`; notificações recebe somente `predioon_notifications`. A senha proprietária `POSTGRES_PASSWORD` entra apenas no banco e no serviço administrativo transitório. Ela nunca entra nos containers permanentes da aplicação.

O arquivo segue a [sintaxe dotenv do Compose](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/), sem execução como shell. Use aspas simples em `JWT_PRIVATE_KEY` e `JWT_PUBLIC_KEYS`, preservando a sequência literal `\n`. Não carregue esse arquivo com `source`, não o versione e não publique a saída de `docker compose config`, que contém segredos. Para validar a configuração, use sempre `config --quiet`. Mantenha uma cópia protegida das chaves e segredos fora da VPS.

A API em produção exige `JWT_ACTIVE_KID`, `JWT_PRIVATE_KEY` Ed25519 e `JWT_PUBLIC_KEYS`, um objeto JSON que associa cada `kid` ao PEM público. Use um par persistente guardado no gerenciador de segredos; o par efêmero de desenvolvimento é recusado em produção. PEMs podem usar a sequência literal `\n`. O access token tem duração de cinco minutos e a sessão é consultada a cada requisição. A configuração anterior `JWT_SECRET` não é mais usada; a transição exige novo login. Consulte [autenticação](AUTENTICACAO.md).

O Caddy obtém TLS dos quatro serviços web. Para MQTT, obter separadamente um certificado
válido para `mqtt.SEUDOMINIO` e colocar `fullchain.pem` e `privkey.pem` no diretório absoluto
`MQTT_CERTS_DIR`. Os arquivos devem ser legíveis pelo usuário do EMQX. Configurar renovação
e recarga do broker conforme a autoridade certificadora utilizada. O servidor não inicia
MQTTS corretamente sem esses arquivos.

Uma opção é ACME por desafio DNS para `mqtt.SEUDOMINIO`, sem disputar a porta 80 do Caddy. Copie o certificado e sua chave para um diretório dedicado, como `/opt/predioon/mqtt-certs`, e use esse caminho absoluto em `MQTT_CERTS_DIR`. Monte o diretório inteiro e mantenha os mesmos nomes `fullchain.pem` e `privkey.pem`. Dê ao UID/GID do EMQX somente a leitura necessária; confirme a identidade com `docker run --rm --entrypoint id emqx/emqx:6.3.1`. O setup verifica a leitura com esse mesmo usuário antes de parar a aplicação.

Programe a renovação no cliente ACME escolhido e um deploy hook que atualize os dois arquivos e reinicie apenas `emqx`. Reiniciar o broker interrompe as sessões brevemente; a ingestão reconecta usando seu identificador estável. Verifique a nova validade externamente. Certificados autossinados são apenas para ensaios isolados e não atendem aos gateways de produção.

Todos os registros A devem apontar ao IP correto; publique AAAA somente se IPv6 também chegar à VPS. Os quatro nomes HTTPS devem estar acessíveis em 80/443 para a emissão automática. Não use um proxy HTTP/CDN na origem MQTT TCP. API e portais compartilham o mesmo domínio base por causa dos cookies de sessão.

O Compose fixa EMQX 6.3.1. Antes de oferecer o serviço comercialmente, confirmar o
enquadramento da instalação na [licença do EMQX](https://www.emqx.com/en/content/license-faq),
que contém condições para serviços hospedados e produtos embarcados.

## Preparar o banco e iniciar

Na raiz do repositório, em Linux:

```bash
docker compose -f infrastructure/docker-compose.prod.yml --env-file infrastructure/.env.prod config --quiet
bash infrastructure/setup-prod.sh
```

O script valida as variáveis obrigatórias, constrói todas as imagens e verifica chaves JWT, credenciais e leitura dos certificados antes de parar a versão em execução. Depois para API, ingestão e notificações; sobe o banco e aguarda saúde; cria o baseline somente em banco vazio; executa `db:infra` e provisiona as seis roles por `db-admin`. Por fim sobe os seis serviços e espera seus healthchecks. A primeira instalação fica sem usuários até criar a conta administrativa conforme o Anexo B do [manual](IMPLANTACAO_CONDOMINIO.md).

O runner valida a sequência completa de arquivos SQL, confere o histórico em `public.schema_migrations` e aplica apenas pendências. Um lock exclusivo do PostgreSQL serializa executores. A primeira instalação aplica o lote inteiro em uma transação; atualizações posteriores confirmam cada migration junto de sua entrada no ledger. A imagem da API inclui os arquivos SQL usados por esse executor.

As senhas das seis roles restritas são provisionadas em uma etapa administrativa separada, após as migrations 015/038/052. A API usa `predioon_app`, `predioon_identity` e `predioon_broker_auth`; o worker usa `predioon_notifications`; a ingestão usa `predioon_ingest` (observação) e `predioon_access_service` (comandos físicos e ACK). As sete URLs do provisionamento administrativo devem selecionar o mesmo servidor, porta e banco; todas são validadas antes de alterar credenciais. As novas roles começam sem login e o provisionamento o habilita. O SQL038 nunca contém senha nem faz backfill de alertas antigos. O processo HTTP e o worker não precisam de `DATABASE_URL`. O runner não interpreta `psql` genericamente: o arquivo legado 002 tem um adaptador revisado que não define senha padrão.

Desde a052 a ingestão não recebe a conexão administrativa: o container tem somente `DATABASE_URL_INGEST`, `DATABASE_URL_ACCESS_SERVICE` e as chaves MQTT/operacionais, verifica as duas identidades reais no PostgreSQL antes de conectar ao broker e recusa iniciar com `DATABASE_URL`. Configure `INGEST_DB_PASSWORD` e `ACCESS_SERVICE_DB_PASSWORD`; `setup-prod.sh` exige as duas antes de parar qualquer serviço e as passa somente ao serviço administrativo transitório. Rollout: parar ingestão/worker, backup e ensaio de restore, migration 052, provisionar seis roles, iniciar a versão nova preservando `MQTT_CLIENT_ID` e a sessão durável. Não há fallback automático para owner: se a verificação falhar, a ingestão fica parada. O banco vazio exige provisionar o primeiro administrador.
Para um **piloto com dados demonstrativos**, preencher `SEED_PASSWORD` com senha exclusiva
e usar `bash infrastructure/setup-prod.sh --seed`. Isso cria as três contas listadas no README
e os sensores de demonstração; não representa um cadastro real do condomínio.

Para atualizar uma instalação **já acompanhada pelo ledger**, prepare backup recuperável e ensaie a release numa cópia isolada. Configure uma conexão administrativa para o banco correto e execute `docker compose -f infrastructure/docker-compose.prod.yml --env-file infrastructure/.env.prod run --rm --no-deps db-admin pnpm --filter @predioon/db db:infra --check`: saída 0 indica histórico compatível sem pendências; 2 lista migrations pendentes; 1 indica erro, executor concorrente ou incompatibilidade. Depois da revisão, execute novamente `setup-prod.sh` sem `--seed`, coordenando a parada/retomada dos processos conforme a compatibilidade da release. Confira prontidão, login, isolamento e ingestão antes de liberar o tráfego.

Banco com dados/políticas antigas e sem ledger válido é **recusado antes de aplicar SQL**. Não há comando de adoção automática nesta versão. Não apagar dados nem inserir checksums manualmente para contornar a recusa: preservar backup, identificar a release instalada e preparar uma adoção específica validada em cópia. Arquivo já registrado que mudou também interrompe a execução. O fluxo atual não chama `drizzle-kit push --force`; essa ferramenta não substitui o histórico de atualização. Procedimentos completos de falha, retomada e limites estão em [MIGRATIONS.md](MIGRATIONS.md).

## Rollout do webhook durável 038

Antes de aplicar a 038, faça backup recuperável e ensaie a release completa num cluster separado. Configure `NOTIFICATIONS_DB_PASSWORD`; a ausência interrompe o setup antes de parar serviços ou tocar SQL. Confira todos os processos produtores da instalação, incluindo os que não pertencem ao Compose. Os produtores novos gravam alerta e outbox na mesma transação; não podem coexistir com uma versão que ainda envia diretamente o mesmo alerta.

`setup-prod.sh` solicita parada de `ingest`, `notifications` e `api` com prazo de 30 segundos, e recusa a migration se o Compose ainda informar um desses três containers ativo. Só depois inicia banco/baseline, aplica pendências do ledger, provisiona as seis roles e inicia a release completa. O init mínimo do Compose encaminha SIGTERM ao Node; o worker encerra suas próprias tentativas/conexões. Essa verificação comprova a parada desses containers. Ela **não** comprova por si a drenagem de callbacks MQTT, a preservação da sessão/QoS no broker ou a ausência de produtores externos; essas condições precisam de observação operacional antes de liberar o rollout. Não pausar funcionalidades como buffer de implantação e não liberar uma mistura de transporte direto/outbox.

O serviço `notifications` não publica portas. Seu healthcheck executa `src/health.ts` localmente e exige heartbeat recente do processo; a identidade restrita é verificada por tentativa. Heartbeat saudável não comprova que um provedor externo recebeu todas as entregas. Configure `ALERT_WEBHOOK_URL` para um endpoint HTTPS conhecido e valide resultados reais. Sem destino, a entrega termina em estado explícito `no_destination`, sem falsa confirmação e sem backlog ilimitado; configurar a URL posteriormente não ressuscita esses eventos.

Inspecione estados/tentativas pela conexão administrativa em ambiente controlado, preservando dados privados. Falhas de rede, timeout, 429 e 5xx recebem backoff SQL limitado; negativas permanentes não ficam em retry infinito. O consumidor envia uma chave estável de idempotência. Sem contrato de deduplicação no provedor, queda após o efeito HTTP e antes da confirmação pode duplicar a entrega. Não existe retry de comandos físicos nesse worker.

Para reverter o transporte, pare e confira primeiro o worker novo. Defina explicitamente o destino das entregas pendentes/terminais antes de habilitar um produtor antigo com envio direto; não reexecute filas cegamente. Rollback de código não desfaz schema/ledger e uma distribuição sem o arquivo 038 não passa na validação do histórico. Preserve os arquivos históricos e prepare uma release de rollback compatível; não apague entradas do ledger nem tabelas da outbox para fazê-la iniciar.

O aceite deste incremento requer SQL/ACL/leases/pausa, worker com conexões e HTTP reais, todos os produtores, restore e regressões integrais da plataforma. Testes unitários, healthcheck ou sucesso de compilação sozinhos não liberam produção. O aceite local da infraestrutura não substitui ensaios de equipamentos físicos, serviços externos, restauração da operação ou publicação nas lojas.

## MQTT de produção

O broker consulta os endpoints internos `/internal/mqtt/authn` e `/internal/mqtt/authz`,
protegidos por `MQTT_AUTH_SECRET`. O Caddy bloqueia esse prefixo na internet.

- O painel emite usuário/senha por gateway e guarda somente o hash da senha.
- O gateway usa `clientId` igual ao próprio ID e publica apenas nos sensores vinculados.
- A ingestão autentica com `MQTT_INGEST_USERNAME` e `MQTT_INGEST_PASSWORD` e só pode assinar
  os filtros autorizados de telemetria/status e confirmações de acessos; também publica comandos somente para acessos habilitados.
- Autorização sem correspondência resulta em negação; o cache de autorização é desativado
  para a desativação do cadastro valer nas novas publicações.
- `infrastructure/emqx/acl.conf` nega tudo como proteção. Não substituir o autorizador
  HTTP por uma ACL genérica permitindo todos os prédios.
- A porta 1883 fica somente na rede interna do Compose. O gateway externo conecta em
  8883 com TLS e validação de certificado. Nunca configurar `rejectUnauthorized: false`.
- Após rotação de senha, desconectar a sessão antiga no broker se for necessária
  revogação imediata. A nova senha é exigida na próxima autenticação.

A ingestão tenta autenticar novamente depois de uma recusa temporária do broker, por exemplo enquanto a API de autorização reinicia. Isso recupera a conexão e as assinaturas; comandos físicos continuam sem fila offline nem reenvio automático.

O status deve usar QoS 1, retenção e Last Will OFFLINE. Configure o identificador de
condomínio/sensor conforme o cadastro, não conforme os IDs ilustrativos da especificação.

## Verificação da instalação

```bash
curl https://api.SEUDOMINIO/health/ready
docker compose -f infrastructure/docker-compose.prod.yml --env-file infrastructure/.env.prod ps
```

Todos os seis serviços têm healthcheck e devem aparecer como `healthy`:

| Serviço | O que o healthcheck confere |
| --- | --- |
| `db` | `pg_isready` |
| `emqx` | `emqx ctl status` |
| `api` | `/health/ready`: os três logins restritos do banco respondem |
| `ingest` | heartbeat a cada 10 s com a sessão MQTT conectada **e** o banco respondendo; mais de 30 s sem registro é falha |
| `notifications` | heartbeat de um ciclo recente do worker |
| `web` | endpoint de administração local do Caddy |

No portal de administração, **Visão geral → Serviços da plataforma** (058) mostra, para quem tem `platform:read-health`: última leitura recebida e leituras da última hora, fila e falhas de avisos, comandos de portão sem resposta, as tarefas do agendador do banco (automações programadas e retenção) e o tamanho do banco. Só contagens e horários: nenhum valor de leitura, mensagem, destino ou nome de condomínio. A tela marca **Atenção** quando não chega leitura há mais de 15 min com gateways online, quando um aviso espera há mais de 10 min, quando houve falha nas últimas 24 h ou quando uma tarefa do agendador falhou ou está pausada.

Depois verificar login nos três painéis, cadastro de gateway/sensor, publicação de leitura
por TLS, histórico, regra de nível abaixo de 20%, reconexão sem duplicar amostras e bloqueio
de publicação em outro gateway. Em ambiente de teste, o simulador aceita:

```bash
MQTT_URL=mqtts://mqtt.SEUDOMINIO:8883 SIM_MQTT_USERNAME=USUARIO_EMITIDO SIM_MQTT_PASSWORD=SENHA_EMITIDA SIM_GATEWAY_ID=ID_GATEWAY pnpm simulate:hardware
```

O simulador utiliza os sensores `water_01`, `pump_01`, `phase_01`, `leak_01` e `temp_01`;
todos precisam estar vinculados ao gateway de teste. Ele não deve representar um sensor
físico em uso. `MQTT_CA_FILE` é opcional para uma CA privada confiável.

## Operação

Use sempre o mesmo arquivo de ambiente e nome do projeto. Uma função de conveniência em Bash:

```bash
dc() { docker compose -f infrastructure/docker-compose.prod.yml --env-file infrastructure/.env.prod "$@"; }
dc ps
dc logs --tail 100 api ingest notifications
dc run --rm --no-deps db-admin pnpm --filter @predioon/db db:infra --check
```

Para atualizar a partir da main, faça backup recuperável, registre o commit anterior, confira que a cópia está limpa e avance sem criar merge local:

```bash
git status --short
git rev-parse HEAD
git fetch origin main
git pull --ff-only origin main
bash infrastructure/setup-prod.sh
```

O setup pode ser repetido sem `--seed`: baseline já presente é preservado, migrations confirmadas são conferidas pelo checksum e as seis credenciais são reprovisionadas com os valores existentes. Não regenere o ambiente em uma atualização. Trocar `POSTGRES_PASSWORD` no dotenv não altera a senha do owner de um volume existente; faça rotação coordenada no PostgreSQL. Alterar `DOMAIN`/URLs Vite exige reconstruir `web`.

Se preflight ou build falhar, os serviços existentes continuam ativos. Se banco, migration ou provisionamento falhar depois da parada, o script encerra com erro e mantém API/ingestão/notificações paradas; examine logs e o ledger, corrija a causa e repita. Se um healthcheck final falhar, `up --wait` retorna erro e preserva os containers para diagnóstico. Não há rollback de schema automático. Reverta o código somente para uma release compatível com o ledger atual.

Faça dumps com `dc exec -T db pg_dump -U predioon -d predioon -Fc > /CAMINHO_SEGURO/predioon.dump`, com diretório acessível apenas à operação, e copie o backup cifrado para fora do host. Um dump contém dados privados; não o grave no repositório. O procedimento validado de restore do Timescale, roles e RLS está em [BACKUP_E_RESTAURACAO.md](BACKUP_E_RESTAURACAO.md). Teste a restauração em um projeto/volume isolado antes de depender do backup.

Diagnóstico: API sem prontidão costuma indicar credenciais/roles; ingestão sem saúde exige verificar MQTT, identidade e heartbeat; broker sem MQTTS exige conferir caminhos, validade e permissões dos certificados; erro de emissão HTTPS exige conferir DNS A/AAAA, alcance externo de 80/443 e logs do Caddy. Se a rede `172.30.250.0/29` colidir com outra rede, ajuste `PROXY_NETWORK_CIDR`, `PROXY_IPV4_ADDRESS` e `API_PROXY_IPV4_ADDRESS` juntos. API e Caddy precisam de IPs distintos no CIDR; apenas o endereço /32 do Caddy é confiável.

Reinício automático (`unless-stopped`) recupera processos que saem e containers após reinício do Docker. Estado `unhealthy` sozinho não reinicia um processo: monitore os healthchecks e investigue a causa. O endpoint de saúde do Caddy confirma seu processo, e não a validade pública dos certificados; valide HTTPS e MQTTS externamente.

Para ensaiar somente contratos de deploy sem banco real, execute `node --test scripts/deploy-env.test.mjs` e, em Linux com Node 24, `node --test packages/db/test/deployment-contract.test.ts`. `node scripts/test-production-proxy.mjs` cria e remove containers/rede próprios, exercitando os cabeçalhos de confiança, bloqueio interno e entrega SSE. Esses testes usam valores sintéticos e nunca carregam `infrastructure/.env.prod`.

### Atualização com controle de funcionalidades

1. Fazer backup e registrar a versão atual antes de atualizar. Verificar a release com `pnpm db:infra --check` e aplicar as pendências com `pnpm db:infra`; arquivos antigos já confirmados não são reaplicados. Não executar reset ou seed de demonstração em produção. Banco legado sem ledger exige o procedimento específico descrito em [MIGRATIONS](MIGRATIONS.md).
2. Coordenar a atualização da API e da ingestão: pausar os processos antigos, aplicar migrações, iniciar ambos com a mesma versão e conferir os logs. Não disponibilizar a central administrativa enquanto uma ingestão antiga ainda puder ignorar os controles. Gateways podem manter seu buffer durante a atualização conforme o contrato de telemetria.
3. Publicar os três painéis após API e ingestão estarem atualizadas. Portões e vagas começam desligados no nível global (migrations 049 e 050); os demais recursos começam habilitados/herdados. Os controles existentes de equipamentos e portões continuam valendo.
4. Entrar como administrador da plataforma, abrir **Funcionalidades** e conferir a configuração global e de um condomínio de homologação. Testar desativação/retomada, descarte seletivo de leituras, heartbeat, bloqueio de ações, auditoria e preservação de histórico antes da liberação.
5. Em reversão de versão, impedir alterações na central e não iniciar serviços antigos enquanto houver recursos pausados: uma versão sem esses controles pode voltar a aceitar leituras ou comandos. Preservar as novas tabelas e o histórico; preparar uma versão compatível para a recuperação.

Procedimento operacional e efeitos de cada controle: [FUNCIONALIDADES.md](FUNCIONALIDADES.md).

O [procedimento de backup e restauração](BACKUP_E_RESTAURACAO.md) registra o ensaio real de dump customizado, recuperação Timescale e preservação de RLS/ledger, além dos limites e das etapas para um destino separado.

Configurar backup com teste de restauração, monitoramento de disponibilidade e renovação
de certificados. As políticas comentadas em `001-timescale-rls.sql` são referências de retenção/compressão, não instruções para editar uma migration já aplicada. Definir os prazos conforme a operação e publicar a alteração numa nova migration revisada. Um rollback de código não desfaz mudanças de schema ou dados.

O canal `ALERT_WEBHOOK_URL` envia alertas HIGH/CRITICAL a um integrador de mensagens.
Sem provedor configurado, o sistema mantém os alertas no painel/log. Não há envio direto
implementado para WhatsApp ou e-mail.

Os painéis também podem ser hospedados como arquivos estáticos, compilados com
`VITE_API_URL` da API pública e os rewrites de SPA existentes. API e ingestão exigem processos
permanentes; o banco precisa suportar TimescaleDB e LISTEN/NOTIFY. Os portais agora usam
refresh em cookie HttpOnly/SameSite=Strict: API e portais precisam compartilhar o mesmo
site HTTPS, como os subdomínios do Compose. No provedor estático, configure domínios
próprios desse mesmo site e suas origens exatas no CORS. As URLs Vercel históricas não
foram atualizadas nem validadas; uma origem de outro site não se torna compatível
somente por entrar no CORS. Publique a API antes dos portais e siga a
[transição de sessões web](AUTENTICACAO.md#implantação-e-transição-dos-portais).
