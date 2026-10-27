# Migrações, preparação e recuperação do banco

Este documento descreve o executor presente no código. Ele prepara instalações novas e atualiza bancos com histórico válido. Não declara concluídas as demais etapas da plataforma nem oferece adoção automática de bancos legados sem histórico.

## Comandos e responsabilidade

| Comando | O que faz | Uso de credencial |
|---|---|---|
| `pnpm db:wait` | Aguarda uma consulta simples ao PostgreSQL ter sucesso | `DATABASE_URL` |
| `pnpm db:bootstrap` | Cria o baseline em banco vazio; valida e preserva baseline existente | Administrativa |
| `pnpm db:infra --check` | Confere baseline, histórico, checksums e pendências, sem aplicar SQL de migration | Administrativa; somente consultas e lock de sessão |
| `pnpm db:infra` | Aplica somente migrations pendentes e registra cada confirmação | Administrativa |
| `pnpm db:provision-runtime` | Configura login/senha das seis roles restritas conforme as sete URLs do ambiente | Administrativa |
| `pnpm db:seed` | Cria/complementa demonstração e redefine senhas das contas demonstrativas | Administrativa; ambiente descartável |

Todos os comandos resolvem o banco pelas variáveis de ambiente, com `.env` da raiz como configuração local. `db:infra` não escolhe um banco por nome de container nem ignora uma `DATABASE_URL` já definida no processo. Confira host, porta e nome do banco antes de uma operação administrativa. Não publique a URL completa nem senhas em logs ou chamados.

`db:push` continua disponível como ferramenta de desenvolvimento do Drizzle. Ele não é o mecanismo de atualização de uma instalação com ledger e não deve ser usado para contornar um erro do runner.

## 1. Baseline: estrutura inicial

`packages/db/drizzle/0000_baseline.sql` descreve a estrutura inicial. `db:bootstrap` usa uma transação e lock próprio para:

1. Criar essa estrutura quando o schema público está vazio.
2. Reconhecer as tabelas, constraints validadas e índices válidos esperados quando a estrutura já existe.
3. Recusar schema parcial ou desconhecido, sem reconstruir tabelas nem apagar dados.

Bootstrap não é um importador de dados, não aplica as migrations de infraestrutura e não cria usuários de demonstração. O arquivo de baseline também não é um retrato atualizado automaticamente a cada mudança do ORM.

A conferência do baseline e os checksums do ledger não constituem uma comparação exaustiva de todos os objetos do banco. Alterações manuais continuam exigindo investigação; o histórico não prova sozinho que ninguém alterou uma função ou coluna fora do processo.

## 2. Primeira instalação

Com banco novo acessível, extensões disponíveis no servidor e credencial administrativa:

```powershell
pnpm db:wait
pnpm db:bootstrap
pnpm db:infra
pnpm db:infra --check
pnpm db:provision-runtime
```

O primeiro `db:infra` exige baseline completo e vazio, sem evidência de infraestrutura anterior. A extensão TimescaleDB pode estar pré-instalada pelo template da imagem oficial; sua presença, isoladamente, não caracteriza um banco legado. Dados existentes, tabelas públicas adicionais, helpers de aplicação ou políticas anteriores sem histórico válido são motivos de recusa.

O executor lê todos os `infrastructure/*.sql`, valida os nomes e exige sequência numérica contínua a partir de 001. Arquivo ausente, número duplicado ou metacomando `psql` não reconhecido impede a execução antes da aplicação do lote.

Na primeira instalação, todas as migrations pendentes são aplicadas em **uma transação**. Assim, políticas antigas de arquivos iniciais não ficam temporariamente visíveis entre commits antes de suas substituições posteriores. Uma falha desfaz o lote inteiro. A tabela vazia do ledger pode permanecer criada; isso não significa que alguma migration tenha sido confirmada.

O TimescaleDB deve estar instalado no servidor PostgreSQL. O executor não instala pacotes do sistema operacional, não transforma PostgreSQL comum em uma imagem Timescale e não reinicia a máquina.

## 3. Ledger e checksums

O histórico fica em `public.schema_migrations`:

| Campo | Significado |
|---|---|
| `id` | Nome do arquivo sem `.sql`, por exemplo `001-timescale-rls` |
| `checksum` | SHA-256 da fonte correspondente, normalizando CRLF para LF |
| `applied_at` | Instante registrado pelo PostgreSQL na confirmação da migration |

Cada arquivo aplicado precisa existir na release atual com o mesmo checksum. O histórico precisa ser um prefixo ordenado da sequência disponível. Isso impede retirar um arquivo histórico, inserir uma migration no meio do passado ou alterar silenciosamente uma migration já executada.

Comentários, espaços e outras alterações de conteúdo também mudam o checksum. Depois de publicada/aplicada, uma migration deve permanecer imutável. A correção segue em **novo arquivo numerado no fim da sequência**, com revisão e testes próprios.

O ledger tem RLS sem policies de runtime. O runner revoga privilégios de `PUBLIC`, `predioon_app`, `predioon_identity`, `predioon_broker_auth` e `predioon_notifications`, inclusive depois de scripts legados que concedem permissões amplas sobre tabelas. A conta administrativa continua capaz de administrá-lo; portanto, proteger essa credencial é parte do controle de mudanças.

### Compatibilidade do arquivo 002

`002-app-role.sql` contém comandos específicos do `psql`, incluindo tratamento de senha. O executor TypeScript usa um adaptador **exclusivo e revisado para esse arquivo**, validado contra um hash conhecido da fonte original.

O adaptador cria `predioon_app` sem login quando necessário, usa o nome real do banco para a concessão de conexão e preserva os demais SQLs revisados. Ele não aplica a senha padrão do script legado. Login e senha ficam em `db:provision-runtime`. O checksum registrado inclui tanto a fonte original quanto o SQL executável do adaptador. Uma mudança inesperada no arquivo 002 é recusada até revisão explícita; não há interpretador genérico de metacomandos.

## 4. Exclusão mútua e transações

O runner reserva uma única conexão PostgreSQL para todo o trabalho. Nela, adquire um advisory lock exclusivo associado ao banco e ao schema do ledger. O lock, os `BEGIN`/`COMMIT`, o SQL e as entradas no histórico usam essa mesma conexão; nenhum subprocesso `psql` faz alterações por fora da transação.

Depois da primeira instalação, cada nova migration tem sua própria transação. Seu SQL e sua entrada no ledger confirmam juntos. Se a migration seguinte falhar, as anteriores que já confirmaram permanecem registradas; uma nova execução continua a partir da primeira ainda pendente.

O lock permanece durante a sequência e é liberado ao terminar. Uma conexão perdida libera seu lock de sessão no servidor; PostgreSQL desfaz a transação não confirmada. O processo não força a tomada do lock de outro executor.

Não colocar `BEGIN`/`COMMIT` próprios, chamadas externas ou operações incompatíveis com transação em uma migration desse runner. Não manter uma transação esperando provedor de mensagem, API externa ou intervenção manual. Migrações maiores devem considerar duração dos locks, volume de dados e compatibilidade com processos ainda ativos.

## 5. Verificação sem alterações

```powershell
pnpm db:infra --check
```

O comando lê a release e o banco, sem criar o ledger, mudar ACLs ou executar migrations. Um lock compartilhado impede a consulta de um estado intermediário enquanto o runner exclusivo está atuando. Se outro executor já estiver ativo, a consulta informa isso imediatamente.

| Saída | Resultado | Próximo passo |
|---|---|---|
| 0 | Histórico compatível, sem pendências | Iniciar os serviços compatíveis com essa release |
| 2 | Migrations pendentes listadas | Revisar a atualização e executar `db:infra` explicitamente |
| 1 | Falha de conexão, baseline incompleto, histórico incompatível, legado sem ledger ou executor em andamento | Ler o diagnóstico e resolver a causa; não tratar como permissão para reset |

O check não abre permanentemente a credencial administrativa na API. Ele é um comando de preparação/inicialização local. Um check bem-sucedido também não substitui prontidão, login, autorização e validação operacional após a atualização.

## 6. Inicialização no Windows

`scripts/start-local.ps1` verifica Node, pnpm, Docker, `.env` e dependências; sobe banco/broker pelo Compose e aguarda PostgreSQL. O script então confere `db:infra --check`. Somente se o histórico estiver pronto inicia API, ingestão e portais.

| Invocação | Comportamento |
|---|---|
| `scripts/start-local.ps1` | Retoma infraestrutura e confere histórico; não instala dependências, migra ou semeia |
| `scripts/start-local.ps1 -Setup` | Instala pelo lockfile, prepara baseline, aplica pendências e provisiona roles, sem seed |
| `scripts/start-local.ps1 -Setup -SeedDemo` | Faz a preparação e também o seed demonstrativo solicitado |

Uma falha interrompe os próximos passos. O script não executa `infra:reset`, não apaga volumes e não reinicia o computador. `pnpm dev` chamado diretamente continua sendo apenas o iniciador dos processos da aplicação; não faz essa preparação.

## 7. Atualização com histórico conhecido

1. Registrar a release atual e preparar backup recuperável. Ensaiar a atualização em cópia isolada, incluindo permissões e TimescaleDB.
2. Conferir as migrations novas e a compatibilidade temporária entre versões da API/ingestão/clientes.
3. Configurar a conexão administrativa para o banco correto e executar `db:infra --check`.
4. Coordenar pausa/retomada dos processos quando a mudança exigir. O lock do runner serializa migrations, não bloqueia automaticamente toda operação de negócio.
5. Executar `db:infra` e depois `db:infra --check`.
6. Provisionar credenciais apenas quando previsto, iniciar os processos da release e validar prontidão, sessão, isolamento e ingestão.

`infrastructure/setup-prod.sh` segue baseline → runner → provisionamento e só executa seed com `--seed`. Os workflows de plataforma e navegador executam o runner duas vezes em banco descartável; a segunda passagem deve verificar o histórico sem reaplicar arquivos.

## 8. Falhas e recuperação

| Diagnóstico | Interpretação e procedimento |
|---|---|
| `Migration ... não foi confirmada` | A transação ativa foi revertida, ou a conexão falhou em um momento que exige confirmação do resultado. Consultar ledger/check antes de repetir; não assumir sucesso ou falha pelo encerramento do terminal. |
| Checksum divergente | A release mudou um arquivo já aplicado. Recuperar a fonte exata da release correspondente; corrigir o comportamento por nova migration. Não substituir o checksum no banco. |
| Migration aplicada ausente | A versão local está incompleta ou anterior ao histórico. Usar uma release compatível com os arquivos históricos; rollback de código não desfaz banco. |
| Sequência incompleta/duplicada | A distribuição dos arquivos está incompleta. Corrigir a release antes de tentar aplicar. |
| Baseline parcial | Uma instalação interrompida ou alteração manual deixou objetos esperados ausentes. Preservar dados e diagnosticar em cópia; não usar `db:push` ou reset para esconder a diferença. |
| Executor em andamento | Aguardar sua conclusão, verificar logs e executar check novamente. Não encerrar processos de outras instalações por suposição. |
| Legado sem ledger | Seguir a seção seguinte; não repetir scripts antigos. |

Retomar um processo após falha não reverte migrations que já confirmaram. Uma correção de dados destrutiva pode exigir restauração ou uma migration compensatória revisada; não existe rollback automático universal. O backup só comprova recuperação depois de restaurado e verificado em ambiente separado. As metas operacionais de RPO/RTO da arquitetura ainda dependem desse ensaio, sem garantia já demonstrada por este runner.

## 9. Banco legado sem histórico

Um banco pode ter tabelas e RLS válidas e, ainda assim, não ter informação suficiente para atribuir cada arquivo desta release ao estado instalado. Reexecutar scripts antigos pode restaurar uma concessão removida, substituir uma política vigente ou rejeitar um escopo adicionado depois. Por isso o comando recusa a adoção silenciosa.

Procedimento atual: preservar backup e release conhecida; inventariar schema, funções, policies, grants e dados; reproduzir o banco numa cópia isolada; definir e revisar uma migração específica de adoção; provar que revogações e dados permanecem corretos. Essa automação **não está entregue**. Não há flag que apenas carimbe uma lista de checksums nem instrução para preencher o ledger manualmente.

Um banco demonstrativo descartável pode ser recriado somente quando seu proprietário confirmar que não há dados necessários. Isso é uma nova demonstração, não migração nem recuperação de produção.

## 10. Administrador e runtime

| Credencial | Destino atual |
|---|---|
| `DATABASE_URL` | Bootstrap, migrations, seed, provisionamento e CLIs administrativos; nenhum runtime a usa |
| `DATABASE_URL_APP` / `predioon_app` | Operações HTTP de negócio com contexto de usuário e RLS |
| `DATABASE_URL_IDENTITY` / `predioon_identity` | Autenticação e sessões |
| `DATABASE_URL_BROKER_AUTH` / `predioon_broker_auth` | Autenticação/autorização do broker |
| `DATABASE_URL_NOTIFICATIONS` / `predioon_notifications` | Entrega de webhook através de funções restritas; sem tabelas ou credenciais diretas |
| `DATABASE_URL_INGEST` / `predioon_ingest` | Observação: recibos, telemetria, consumo, heartbeat, estacionamento e alertas+outbox por funções privadas (052); sem segredos, configuração ou comandos |
| `DATABASE_URL_ACCESS_SERVICE` / `predioon_access_service` | Comandos físicos: expirar, selecionar, marcar SENT, falhas fechadas e ACK, somente por funções privadas (052); sem DML direto |

As sete URLs de provisionamento devem apontar ao mesmo servidor, porta e banco e usar os papéis esperados. O comando valida owner e as seis roles antes de conectar, sem compatibilidade opcional que omita uma delas. Nenhum runtime recebe a conexão proprietária em produção; a ingestão lê `services/ingest/.env.runtime` (gerado por `pnpm ingest:env`) ou as duas variáveis injetadas. A 038 não reenvia alertas históricos. Seus produtores antigos precisam estar interrompidos antes da migration, com filas e sessão MQTT conferidas pelo operador; veja [DEPLOY.md](DEPLOY.md#rollout-do-webhook-durável-038).

## Testes em banco isolado

Exemplo PowerShell, na raiz do repositório. O nome e a porta devem estar livres; se já estiverem usados, escolha outros e ajuste **todas** as URLs. Não reutilize o container da instalação cotidiana ou de outro teste em execução.

```powershell
docker run --detach --name predioon-db-check --publish 127.0.0.1:5439:5432 --env POSTGRES_USER=predioon --env POSTGRES_PASSWORD=predioon --env POSTGRES_DB=predioon --env TIMESCALEDB_TELEMETRY=off timescale/timescaledb:2.17.2-pg16
$env:DATABASE_URL = "postgres://predioon:predioon@localhost:5439/predioon"
$env:DATABASE_URL_APP = "postgres://predioon_app:predioon_app@localhost:5439/predioon"
$env:DATABASE_URL_IDENTITY = "postgres://predioon_identity:predioon_identity@localhost:5439/predioon"
$env:DATABASE_URL_BROKER_AUTH = "postgres://predioon_broker_auth:predioon_broker_auth@localhost:5439/predioon"
$env:DATABASE_URL_NOTIFICATIONS = "postgres://predioon_notifications:predioon_notifications@localhost:5439/predioon"
$env:DATABASE_URL_INGEST = "postgres://predioon_ingest:predioon_ingest@localhost:5439/predioon"
$env:DATABASE_URL_ACCESS_SERVICE = "postgres://predioon_access_service:predioon_access_service@localhost:5439/predioon"
pnpm db:wait
pnpm db:bootstrap
pnpm db:infra
pnpm db:infra
pnpm db:provision-runtime
pnpm db:seed
$env:TEST_MIGRATIONS_DATABASE_URL = $env:DATABASE_URL
$env:RUN_ACCESS_DB_TESTS = "1"
$env:RUN_RBAC_DB_TESTS = "1"
pnpm --filter @predioon/db exec node --import tsx --test --test-concurrency=1 test/*.test.ts
# As suítes integradas da ingestão autenticam com as duas roles; a URL dona serve só à fixture.
$env:TEST_INGEST_DISPOSABLE_DB = "1"
$env:TEST_INGEST_DATABASE_URL = $env:DATABASE_URL
$env:TEST_INGEST_RUNTIME_DATABASE_URL = $env:DATABASE_URL_INGEST
$env:TEST_ACCESS_RUNTIME_DATABASE_URL = $env:DATABASE_URL_ACCESS_SERVICE
pnpm test
```

As senhas acima são apenas do container descartável local. `TEST_MIGRATIONS_DATABASE_URL` precisa permitir criar/remover bancos temporários. A suíte verifica instalação nova, concorrência, rollback, checksums, recusa de legado, preservação de grants, privilégio do ledger, consulta sem alterações e CLI da release atual. Os testes de aplicação não substituem verificação de equipamento físico.

Os testes SQL038 e do worker usam `TEST_NOTIFICATION_DATABASE_URL`. Configure também o opt-in `TEST_NOTIFICATION_DISPOSABLE_DB=1`, somente contra cluster próprio em loopback. Eles criam bancos com UUID, mas também alteram atributos/senhas de papéis globais; por isso **não** podem compartilhar o cluster da API, do browser, de outra suíte ou de uma instalação. O job `notifications` em `ci.yml` fornece esse isolamento e executa SQL e worker sequencialmente. Uma suíte sem essa configuração registra skip; não é aceite de notificações. Nunca ligar essas variáveis apontando para o exemplo da suíte geral acima enquanto ela estiver ativa.

As suítes SQL052 (`ingest-runtime*`, `access-service*`) e as suítes de serviço da ingestão também alteram roles globais. Elas exigem `TEST_INGEST_DISPOSABLE_DB=1`, `TEST_INGEST_DATABASE_URL` em loopback e a identidade fixada do cluster (`TEST_INGEST_CONTAINER_ID`, `TEST_INGEST_EXPECTED_CONTAINER_ID`, `TEST_INGEST_EXPECTED_SYSTEM_IDENTIFIER`). O job `ingest-runtime` do CI fornece esse cluster próprio e roda, em sequência, as suítes SQL052 e `scripts/test-ingest-restricted-suites.mjs`, que cria um banco novo por suíte de serviço (inclusive produtores/outbox). Sem as variáveis TEST_INGEST_*, as suítes SQL052 registram skip; não é aceite das credenciais restritas.

O inicializador Windows possui teste isolado com ferramentas simuladas:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-start-local.ps1
```

Ele cobre retomada de infraestrutura parada, bloqueio por pendência/legado, falha de infraestrutura, setup sem seed implícito e seed explicitamente pedido. Esse teste não instala dependências, não executa Docker nem altera banco real. A suíte PostgreSQL deve ser executada separadamente. Ao terminar, encerre somente os containers descartáveis identificados para esse ensaio e remova as variáveis do terminal ou feche esse terminal antes de voltar à instalação habitual.

## Release de identidade037

`037-password-change.sql` acrescenta o helper privado de troca da própria senha. Não concede UPDATE direto em users nem EXECUTE a app/broker. ACL/owner/search_path e persistência efetiva das transições são verificados em testes; as famílias são revogadas junto da alteração da credencial. Consulte [TROCA_DE_SENHA.md](TROCA_DE_SENHA.md) para contrato, locks e limites.

A release da API muda a serialização de login/refresh/revogação. Coordenar todas as instâncias: pausar tráfego de identidade, encerrar workers antigos, aplicar037 com credencial administrativa, iniciar a release nova completa e conferir prontidão/login/refresh/troca antes de reabrir o tráfego. Não operar um rollout misturando a lógica antiga de locks/hash com o endpoint novo. Seed/reset não são passos de atualização de produção.

O ensaio de037 passou26/26 testes de banco com as flags reais, incluindo dump/restauração serial de44 tabelas e37 migrations. O helper restaurado alterou apenas sua conta, revogou duas famílias e preservou outro usuário e a origem. Logs locais work/password037-db-full-verified.log e work/password037-backup-directed.log. Isso comprova o recorte lógico/ACL do teste descartável; aceite de implantação real e operação permanece no plano maior.

## Release comercial039: organizações

`039-organizations-capabilities.sql` introduz `organizations:read` e `organizations:manage` como capacidades globais. Leitura exige read; criação/edição exige ambas. O papel PLATFORM_ADMIN recebe os defaults na primeira aplicação. A fonte do papel conserva a compatibilidade021: flag persistida real ou binding global vigente, sempre sujeitos a usuário, papel, permission e grant atuais. Revogar apenas um binding de uma conta cuja flag continua verdadeira não elimina essa segunda fonte. Organização comercial não concede acesso aos seus imóveis, moradores, finanças ou comandos.

A migration substitui as policies comerciais de organizations, preserva a leitura privada da identidade, retira DELETE e alteração de id/created_at do runtime e limita INSERT/UPDATE às colunas necessárias. Estende a whitelist global atual e somente os dois ramos de criação/edição de organização nas provas de auditoria. Se a forma desses helpers divergir da fonte esperada, o DDL falha dentro da transação da migration; investigar a divergência, sem editar migrations históricas. Reaplicar039 não reativa permissões/grants revogados.

A API publica a projeção autenticada `GET /v1/authorization/platform`, com no-store e apenas essas duas capacidades. GET/POST/PATCH de organizations conferem a autoridade atual em transação, inclusive após espera por lock e depois da auditoria; uma revogação observada nessa janela reverte dados e audit juntos. O limite é o último statement confirmado: não há promessa de impedir revogação posterior ao commit ou serialização absoluta de todo SQL direto.

Coordenar aplicação039 e releaseAPI; um processo antigo com guard por role não é consumidor da nova autorização comercial. O portal administrativo precisa também do consumidor por capacidades, com gates antes de montar telas e revalidação antes de escrita; esse checkpoint é acompanhado em [CONTINUIDADE.md](CONTINUIDADE.md). Para uma instalação já existente, usar bootstrap de reconhecimento e db:infra/check; seed/reset são exclusivamente de demonstração descartável. Preparar backup e ensaio de restauração da release completa antes de rollout real. Não reduzir o ledger para038 nem restaurar policies amplas como rollback: recuperar backup validado e a release correspondente em ambiente isolado, ou entregar uma nova migration de correção.

Em 05/10/2026, a segunda integral da API em cluster próprio passou **721/721 testes, 54 suítes, zero falhas/skips/cancelamentos**. A duração registrada foi 28.983.317,949 ms, incluindo um grande intervalo de relógio durante a telemetria; a causa dessa interrupção não foi estabelecida. A primeira rodada, 719/721, permanece registrada: duas expectativas de auditoria global ignoravam eventos legítimos anteriores. A fixture agora pagina o endpoint real, confirma o histórico independente e compara somente seus próprios IDs, preservando as negativas e todos os registros anteriores.

São provas separadas: 161/161 adjacentes, SQL de notificações 54/54 e restauração **2/2**, nos modos mesmo cluster e dois clusters físicos separados, com **49 tabelas e 39 migrations** em cada modo. A restauração independente veio do archive, sem reaplicar migrations no destino; dados, helpers, ACL/RLS, ledger e estado de notificações foram verificados. Esses ensaios descartáveis não estabelecem RPO/RTO nem homologam implantação real. O consumidor administrativo e a matriz de navegador continuam em validação. [CONTINUIDADE.md](CONTINUIDADE.md) conserva fontes, falhas, resultados e pendências.

## Release de privilégio mínimo 040: ACL de `users`

`040-users-runtime-acl.sql` retira de `predioon_app` a leitura de `password_hash`/`updated_at` e todo `UPDATE`/`DELETE` direto em `users`, inclusive concessões residuais por coluna. Permanecem o `INSERT` do cadastro legado e o `SELECT` de exatamente sete colunas públicas: `id`, `name`, `email`, `phone`, `is_platform_admin`, `active` e `created_at`. RLS, helpers `SECURITY DEFINER`, a role de identidade e os demais papéis não mudam. Não há fallback pela conexão proprietária.

O motivo é o RED registrado em 05/10/2026: com a role da API, uma sessão SQL conseguia ler o próprio hash, elevar a própria flag administrativa, substituir o hash e apagar a própria linha. Não se alega exploração por HTTP; o recorte fecha a fronteira no banco.

Coordenar com a release da API: qualquer consulta do runtime que selecione `users.*` passa a falhar com 42501. Credenciais continuam sendo lidas e trocadas somente pela conexão de identidade e pelo helper da 037.

## Release 041: auditoria da edição e do estado de blocos, unidades e equipes

`041-tenancy-edit-audit.sql` acrescenta as ações `*_UPDATED`, `*_DEACTIVATED` e `*_REACTIVATED` de bloco, unidade e equipe aos três ramos correspondentes de `app_audit_legacy_insert`, com a mesma prova da criação: capacidade de gestão vigente no condomínio e registro pertencente a ele. A alteração é feita por substituição exata do ramo; ramo ausente, duplicado ou divergente interrompe a migration dentro da transação. Reaplicar não muda função, ACL nem policy. Privilégios de tabela e RLS da 014 já cobriam o `UPDATE`; a 041 não concede nada novo.

A API passa a publicar `PATCH /v1/tenancy/{blocks,units,teams}/:id` e `.../:id/status` (ver [AUTORIZACAO.md](AUTORIZACAO.md)). Um processo antigo da API continua funcionando com a 041 aplicada; a API nova exige a 041, pois sem ela a auditoria obrigatória é recusada e a edição é revertida.

## Release 042: convites de moradores

`042-resident-invitations.sql` cria a tabela `invitations` (a 50ª tabela pública), com RLS e privilégios por coluna para `predioon_app`: leitura sem `token_hash`, inserção e atualização apenas de `revoked_at`/`revoked_by`. Acrescenta o ramo `INVITATION_CREATED`/`INVITATION_REVOKED` à prova de auditoria, falhando fechado se a função não terminar no ramo único de negação, e dois helpers de identidade com `EXECUTE` somente para `predioon_identity`: `identity_invitation_preview` e `identity_accept_invitation`. Contrato e motivos em [AUTENTICACAO.md](AUTENTICACAO.md#convites-de-moradores).

A API nova exige a 042. Uma API antiga continua funcionando com a 042 aplicada. No build dos portais, `VITE_RESIDENT_URL` é opcional; o Compose de produção passa `https://morador.${DOMAIN}`.

## Release 043: ordens de serviço

`043-work-orders.sql` cria `work_orders` e `work_order_events`, quatro helpers de acesso, o gatilho de campos e transições, as policies de RLS para `predioon_app` e o ramo de auditoria `WORK_ORDER_CREATED`/`UPDATED`/`STATUS_CHANGED`. Não cria permissões: as três `work-orders:*` vêm da 014. Contrato e motivos em [ORDENS_DE_SERVICO.md](ORDENS_DE_SERVICO.md).

A API nova exige a 043; uma API antiga continua funcionando com ela aplicada. O gatilho não restringe manutenção administrativa feita fora de um contexto de usuário (conexão proprietária sem `app.user_id`).

## Release 044: ativos

`044-assets.sql` cria `assets` e `asset_device_links`, acrescenta `work_orders.asset_id`, o gatilho de ativos, as policies de RLS e o ramo de auditoria `ASSET_CREATED`/`ASSET_UPDATED`. **Substitui a função `app_work_order_guard` da 043**, que passa a tratar o ativo; nenhuma migration publicada foi editada. Não cria permissões. Contrato e motivos em [ATIVOS.md](ATIVOS.md).

A API nova exige a 044. Uma API antiga continua funcionando com ela aplicada, pois a coluna nova é opcional.

## Release 045: automações

`045-automations.sql` cria `automation_rules`, `automation_versions` e `automation_runs`, a função única de correspondência, os gatilhos de guarda, a simulação e o ramo de auditoria. **Acrescenta o gatilho `alerts_automations` (AFTER INSERT) na tabela `alerts`**, que é gravada pela ingestão: ele só age para regras ativas com versão publicada, isola cada regra e nunca impede a gravação do alerta. Não cria permissões. Contrato e motivos em [AUTOMACOES.md](AUTOMACOES.md).

A API nova exige a 045. A ingestão não muda de versão: sem regras ativas o gatilho apenas consulta e sai.

## Release 046: verificação em duas etapas

`046-mfa.sql` cria `mfa_factors` e `mfa_recovery_codes`, com RLS e privilégios somente para `predioon_identity` (nas colunas mutáveis: confirmação, último intervalo aceito e uso do código de recuperação). Nenhuma outra role as alcança. Contrato e motivos em [AUTENTICACAO.md](AUTENTICACAO.md#verificação-em-duas-etapas-mfa).

A API nova exige a 046, porque todo login consulta se a conta tem fator ativo. Definir `MFA_ENCRYPTION_KEY` antes de liberar a ativação em produção.

## Release 047: recuperação de senha

`047-password-recovery.sql` cria `password_resets`, com RLS e **sem privilégio para nenhuma role de execução**, e as funções `identity_issue_password_reset` e `identity_reset_password`, executáveis somente por `predioon_identity`. Contrato e motivos em [AUTENTICACAO.md](AUTENTICACAO.md#recuperação-de-senha-por-e-mail).

A API nova exige a 047 só nas duas rotas de recuperação; entrada, sessões e MFA não dependem dela. O envio precisa de `RESEND_API_KEY`; sem a chave as rotas respondem normalmente e nenhum e-mail sai.

## Release 048: identidade do recibo de telemetria

`048-telemetry-receipt-scope.sql` troca a chave de `ingest_events` de `event_id` para `(building_id, device_id, event_id)`, acrescenta a coluna `fingerprint` (nula nas linhas antigas) e cria `ingest_rejections`, contadores sem conteúdo e sem privilégio para as roles da API. Motivos em [INBOX_DECISOES.md](INBOX_DECISOES.md).

**Ordem de implantação:** parar a ingestão, aplicar a 048 e subir a ingestão nova. A ingestão antiga procura duplicata só por `event_id` e não deve gravar depois da troca de chave. A API não depende da 048. A troca de chave é segura sobre dados existentes, porque a chave antiga já garantia unicidade.

## Release 049: portões e vagas desligados por padrão

`049-physical-features-opt-in.sql` grava `GARAGE_ACCESS`, `PEDESTRIAN_ACCESS`, `CAR_PARKING` e `MOTORCYCLE_PARKING` como **desligadas no nível global** numa instalação que ainda não tem condomínios. As demais funcionalidades seguem a regra da 012: sem configuração, ligadas.

**Instalação que já tem condomínios** não é alterada pela 049; quem cuida dela é a 050, abaixo.

**Para ligar:** administração → Funcionalidades. O desligamento global é teto: enquanto estiver desligado, nenhum condomínio consegue ligar localmente.

**Ambientes de teste** que exercitam portões e vagas precisam ligá-las de forma explícita: `SEED_PHYSICAL_FEATURES=enabled pnpm db:seed` (já está nos workflows). Testes que montam o próprio banco só com migrations fazem o `update` na preparação.

## Release 050: portões e vagas desligados também em instalações existentes

`050-physical-features-off-existing.sql` aplica o padrão da 049 a instalações que já têm condomínios, sem passo manual. Para cada uma das quatro funcionalidades **sem configuração global registrada**, grava o desligamento e, em cada condomínio onde ela estava de fato ligada, reproduz os efeitos da transição auditada da API (SQL038): avança a geração de execução, limpa a ocupação das vagas, cancela e audita os comandos de portão pendentes e cancela entregas de alerta que deixaram de ser elegíveis. Os registros de auditoria saem como `SYSTEM`, sem nomear uma pessoa.

**O que ela não toca:** uma configuração global que alguém já registrou, ligada ou desligada, fica como está; cadastros de portões, vagas e equipamentos são mantidos; comandos já enviados não são reescritos.

**Efeito ao aplicar:** as telas de Acessos e Vagas somem dos portais e dos aplicativos, e a ingestão passa a recusar leituras desses módulos. Para religar: administração → Funcionalidades.

## Release 051: morador sem nível da caixa d'água; consumo só com liberação do síndico

`051-resident-consumption-opt-in.sql`:

- retira do papel **Morador** a leitura do nível publicado da caixa d'água (`telemetry:read-published`). O vínculo antigo de morador (tabela `memberships`) perde a leitura junto, porque segue o mesmo catálogo. A equipe do condomínio continua com a leitura.
- cria a capacidade `monitoring:read-published` para os papéis Morador e Síndico (`BUILDING_ADMIN`) e a tabela `resident_consumption_settings`, sem privilégio para nenhuma role de execução. **Sem linha, o consumo não está liberado.**
- cria três funções: `app_resident_consumption_released`, `app_set_resident_consumption` (só quem administra o condomínio; audita `RESIDENT_CONSUMPTION_CHANGED` na mesma transação) e `app_published_consumption`, a projeção fixa entregue ao morador.

**O que o morador recebe quando liberado:** quantidade diária de energia e de água dos últimos 7 dias, somando os medidores do mesmo tipo. Nunca tarifa, custo, limite, bomba, referência aprendida, leitura bruta ou identificação de equipamento.

**Efeito ao aplicar:** nenhum condomínio fica liberado. Quem já mostrava o nível da caixa d'água ao morador deixa de mostrar.

O Síndico recebe a capacidade porque só concede um papel quem tem todas as permissões dele: sem ela, o síndico deixaria de convidar e vincular moradores. Consequência: quando o consumo está liberado, o síndico também enxerga a mesma visão reduzida do morador.

## Release 052: ingestão e acesso físico com roles restritas

`052-ingest-runtime-roles.sql` cria as roles `predioon_ingest` (observação: recibos, telemetria, consumo, heartbeat, estacionamento, alertas+outbox) e `predioon_access_service` (comandos físicos: expirar, selecionar, marcar SENT, falhas fechadas e ACK). As duas nascem sem login e sem privilégios amplos e só alcançam o banco por funções privadas; o provisionamento habilita o login. A migration recusa aplicar se encontrar direitos de `PUBLIC` em objetos da aplicação, em vez de mudar direitos de consumidores desconhecidos. Não traz senha nem transfere ownership.

**Ordem de implantação:** parar ingestão e worker, backup com ensaio de restauração, aplicar a 052, provisionar as seis roles (`INGEST_DB_PASSWORD` e `ACCESS_SERVICE_DB_PASSWORD` são obrigatórias em `setup-prod.sh`) e iniciar a ingestão nova, preservando `MQTT_CLIENT_ID` e a sessão durável. A ingestão nova recebe só `DATABASE_URL_INGEST` e `DATABASE_URL_ACCESS_SERVICE`, confere as duas identidades antes de conectar ao broker e recusa iniciar com `DATABASE_URL`; não há fallback para a conexão dona. Localmente, `pnpm ingest:env` gera `services/ingest/.env.runtime`. Detalhes em [DEPLOY.md](DEPLOY.md).

## Release 053: acesso temporário de suporte

`053-support-grants-management.sql` não cria tabela nem muda o que uma concessão permite (isso vem da 014/021). Ela:

- separa criação e revogação das concessões de suporte para a role da API: inserir exige `support:grant`, pessoa da equipe de suporte da plataforma, outra pessoa que não o próprio administrador e prazo de **até 7 dias**; alterar só pode preencher `revoked_at` de uma concessão aberta. Sem DELETE: o condomínio mantém o histórico. A conexão dona (fixtures, restauração) não é afetada;
- classifica `SUPPORT_STAFF_ADDED`/`SUPPORT_STAFF_REMOVED` como eventos da plataforma e acrescenta as provas de auditoria dessas duas ações e de `SUPPORT_GRANT_CREATED`/`SUPPORT_GRANT_REVOKED` (no condomínio), no mesmo formato das releases 042–045: falha fechado se a função tiver outro formato.

**Efeito ao aplicar:** concessões existentes continuam valendo até o prazo. Quem editava ou apagava concessões direto pela API (não havia rota para isso) passa a receber recusa. Rotas novas em `/v1/support-access`; telas em administração → Acesso de suporte e, para o síndico, Administração → Acesso de suporte.

## Release 054: contas e vínculos legados por capacidade

`054-users-memberships-capabilities.sql` troca as políticas de 001 em `users` e `memberships`, que confiavam no papel legado (`app.role` e vínculo `BUILDING_ADMIN` na tabela `memberships`), pelas capacidades vigentes:

- **contas (`users`, role da API):** a própria pessoa; quem tem `rbac:manage` (administração de RBAC da plataforma); ou quem tem `memberships:read` num condomínio em que a pessoa tem vínculo legado. É a regra de 001 com a checagem de síndico legado trocada pela capacidade. Ligações só por RBAC (papel, unidade, equipe) continuam mostrando apenas os campos mínimos do diretório de pessoas, nunca a conta inteira. Criar conta exige `rbac:manage`;
- **vínculos (`memberships`):** leitura com `memberships:read` (ou o próprio vínculo); criar ou alterar segue a mesma regra de delegação dos papéis (`app_rbac_can_delegate`): ninguém concede um papel cujas capacidades não tem. A API não apaga vínculos (revogação é UPDATE);
- **auditoria:** `USER_CREATED` e `MEMBERSHIP_UPSERTED/REVOKED` passam a aceitar a capacidade em vez da flag legada, com a mesma técnica da 039.

**Efeito ao aplicar:** síndicos e administradores da plataforma continuam com o mesmo acesso; um síndico conhecido só por papel (sem vínculo legado) passa a listar e vincular as pessoas do condomínio em `/users`; um administrador da plataforma só por papel, sem a flag, passa a listar e criar contas. Um papel personalizado com `memberships:manage`, mas sem as capacidades do papel concedido, é recusado. As rotas HTTP `/users` deixaram de usar o papel legado (`requireRole`/ordem dos papéis); o único guard legado restante é o do suporte remoto, cujo banco também confere a conta ativa com a flag da plataforma.

## Release 055: confirmação recente para ações privilegiadas

`055-session-recent-verification.sql` acrescenta `sessions.verified_at`, o instante em que o dono da sessão provou a senha (e o código, se usa MFA) pela última vez nessa sessão. Sessões existentes recebem o horário em que foram criadas, ou seja, ficam com a prova vencida e pedem a senha na próxima ação privilegiada. Novas sessões nascem confirmadas.

Também retira `INSERT`, `UPDATE` e `DELETE` de `sessions` da role da API de negócio (`predioon_app`), herdados da 013 e não usados desde a 015: só a role de identidade mantém sessões. A leitura continua.

**Efeito ao aplicar:** depois da implantação, quem estiver logado há mais de 10 minutos vê a janela de confirmação na primeira ação privilegiada (lista em [AUTENTICACAO.md](AUTENTICACAO.md#confirmação-recente-para-ações-privilegiadas-055)). Nada mais muda para quem só consulta ou faz operações comuns.

## Release 056: catálogo de séries de telemetria

`056-telemetry-series-catalog.sql` cria `telemetry_series` (condomínio, dispositivo, métrica, primeira vez vista) e um gatilho `AFTER INSERT` em `telemetry` que registra cada série nova. O gatilho grava uma vez por série, não por leitura; a função é `SECURITY DEFINER` do dono dos helpers e ninguém a chama diretamente. A API lê o catálogo com a mesma regra de visibilidade da telemetria; nenhuma outra role o lê ou escreve. A migration preenche o catálogo com as séries dos últimos 7 dias.

**Efeito ao aplicar:** a rota `/telemetry/latest` passa a consultar uma leitura por série em vez de ordenar a última semana inteira (medido: 1,3 s → 0,27 s com 50 dispositivos a uma leitura por minuto). O resultado é o mesmo, inclusive o desempate por `id` em leituras no mesmo instante. A restauração por `pg_dump`/`pg_restore` não muda: gatilhos e chaves só são criados depois dos dados.

## Release 057: automações programadas

`057-automation-schedules.sql` acrescenta às versões de automação o gatilho (`trigger_kind` ALERT ou SCHEDULE), o intervalo em dias e a primeira data, com CHECK que impede misturar os dois gatilhos. Em `automation_runs`, uma execução passa a ter alerta **ou** data programada, com chave única por regra e data. A guarda de imutabilidade e a comparação com alertas (045) foram redefinidas para incluir os campos novos. O executor `app_automation_run_schedules()` é registrado no agendador do TimescaleDB a cada 5 minutos.

**Efeito ao aplicar:** automações existentes continuam como gatilho de alerta, sem mudança. A tarefa do agendador aparece em `timescaledb_information.jobs`. O agendador precisa de `timescaledb.max_background_workers` maior que zero (padrão da imagem oficial).

## Release 058: saúde dos serviços da plataforma

`058-platform-service-health.sql` cria `app_platform_service_health()`, exigindo `platform:read-health` (024). Ela devolve só contagens e instantes: última leitura recebida e leituras da última hora, gateways ativos/online, fila e falhas das entregas de aviso (038), comandos de portão aguardando ou sem resposta, as tarefas do agendador do TimescaleDB (automações programadas da 057 e retenção, quando ligada) e o tamanho do banco e das leituras. Nenhuma outra role a executa.

**Efeito ao aplicar:** a rota `GET /overview/platform/services` e o cartão **Serviços da plataforma** na visão geral da administração. Nada muda nas demais telas.


## Release 059: abertura pelo QR do totem

`059-access-qr-totem.sql` acrescenta a chave `GATE_QR_ACCESS` aos `CHECK` de funcionalidades da 012, as colunas `gates.require_qr` (o síndico pode gravar) e `gates.qr_generation` (só a função de renovar altera) e as tabelas `gate_totem_pairings` e `gate_totems`, que guardam apenas o SHA-256 do código de pareamento e do token do tablet. A role da API lê só id, portão, nome e contatos dos tablets, com RLS de quem gerencia o portão; nenhuma role lê os hashes.

A admissão de abertura da 034 passou para `app_request_access_admit`, com um canal (`LIST` ou `QR`) e a geração esperada. `app_request_access(uuid,uuid,text,text)` continua com a mesma assinatura e chama o canal `LIST`; `app_request_access_by_qr` chama o canal `QR` depois que a API confere o HMAC. Novas funções `SECURITY DEFINER`: `app_gate_qr_renew`, `app_gate_totem_pairing_create`, `app_gate_totem_revoke` (para `predioon_app`) e `identity_totem_pair`, `identity_totem_display` (para `predioon_identity`). Detalhes em [ACESSOS](ACESSOS.md#abertura-pelo-qr-do-totem-059).

**Efeito ao aplicar:** nenhum condomínio muda de comportamento. O adicional nasce não liberado em todos, e nenhum portão nasce exigindo QR. A API nova exige a 059. Em produção, defina `GATE_QR_SECRET` (32 bytes ou mais) antes de liberar o adicional; sem ela, as rotas de QR e do tablet respondem 503 e o resto funciona.

## Release 061: prazo do código de pareamento do totem

`061-totem-pairing-clock.sql` redefine só `app_gate_totem_pairing_create`, com a mesma assinatura, dono e permissão. A versão da 059 deixava `created_at` vir do padrão da coluna e calculava `expires_at` com outro `clock_timestamp()`. O PostgreSQL pode avaliar o padrão depois do valor explícito, e então o `CHECK` de 10 minutos recusava a linha por microssegundos. O síndico via, às vezes, "Controlador e gateway precisam pertencer a este prédio" ao clicar em **Parear tablet**. Agora as duas colunas usam o mesmo instante.

**Efeito ao aplicar:** nenhum dado muda. No Neon de demonstração, aplicar com `pnpm --filter @predioon/db db:infra --provider=neon-demo`.

## Release 062: cenários do campo de demonstração

`062-demo-field-scenarios.sql` cria `demo_scenarios` (cenário por condomínio) e `app_demo_scenario_set`, que exige `features:manage` e audita `DEMO_SCENARIO_CHANGED`. A API lê a tabela só para quem tem `features:manage`; a ingestão lê todas as linhas para o gateway simulado; nenhuma role grava diretamente. Ver [DEMO_CAMPO](DEMO_CAMPO.md).

**Efeito ao aplicar:** nenhum. A tabela fica vazia e as rotas só respondem com `DEMO_SCENARIOS=on` na API.

`063-service-guard-admin-memberships.sql` redefine `service_runtime_guard` para aceitar a participação só de administração (sem herdar e sem `SET ROLE`) que o PostgreSQL 16+ concede ao dono que cria o login, como no Neon. Participações que herdam ou permitem `SET ROLE` continuam recusadas. A mesma regra vale em `provision-runtime-roles.ts` e em `verifyRestrictedDatabaseRole`.

## Release 064: limites de reserva, unidade da reserva e eventos

`064-reservation-limits-events.sql` faz quatro coisas, todas decididas no banco:

- **Limites por mês.** `common_areas` ganha `monthly_limit_per_resident` e `monthly_limit_per_unit` (1 a 31; vazio é sem limite). O gatilho `reservations_booking_guard` conta, no mês civil do fuso do condomínio, as reservas pendentes e confirmadas da mesma área, do mesmo morador ou da mesma unidade. Recusadas e canceladas liberam a vaga. As reservas e os eventos de uma área passam por um único advisory lock, então dois pedidos simultâneos não furam o limite.
- **Unidade da reserva.** `reservations.unit_id` aponta para uma unidade atual de quem pede (vínculos de `unit_memberships`). Com uma só unidade ela é preenchida sozinha; um código digitado que corresponda a uma das unidades também vale (apps antigos mandam o texto). Unidade de outra pessoa é recusada. Uma área com limite por unidade exige a unidade. O campo de texto `unit` passa a repetir o código da unidade quando ela existe, e a guarda de transição (029) agora também mantém `unit_id` imutável.
- **Eventos.** `building_events` e `building_event_responses`, com as capacidades novas `events:read`, `events:respond-own` (todos os papéis do condomínio) e `events:manage` (síndico). Um evento pode ocupar uma área comum: no horário dele a área fica ocupada para reservas e outros eventos, e a ocupação vista pelos moradores inclui o intervalo (sem detalhes). Respostas têm acompanhantes até o limite do evento, prazo opcional e limite de pessoas, conferidos com bloqueio por evento. Auditoria: `EVENT_CREATED`, `EVENT_UPDATED`, `EVENT_CANCELLED`.
- **Nome para a gestão.** `app_building_person_name()` devolve só o nome de quem tem algum vínculo com o condomínio, para quem gerencia reservas, eventos ou vínculos ali. Moradores convidados por e-mail só têm role binding e unidade, e a 054 não abre a linha da conta para esses casos.

**Efeito ao aplicar:** nenhuma área ganha limite sozinha e nenhuma reserva existente muda; `unit_id` fica vazio nas reservas antigas. Os eventos seguem a funcionalidade **Reservas**: desligada, eles também saem das telas e da API.
