# Backup e restauração do Prédio ON

## Evidência verificada

Em 03/10/2026, `packages/db/test/backup-restore.test.ts` criou dois bancos descartáveis num PostgreSQL 16 com TimescaleDB 2.17.2. O primeiro recebeu bootstrap, migrations 001–036 e dados sintéticos de dois condomínios. Um arquivo customizado de `pg_dump` foi restaurado serialmente no segundo banco. A suite completa de banco passou26/26, sem skips; log local work/audit036-db-verified.log.

O teste comparou conteúdo das 44 tabelas públicas, ledger, policies, privilégios de tabelas/colunas/funções, owners e definições dos helpers `app_*`/`identity_*`. ACL explícita equivalente à ACL padrão é normalizada; nenhuma concessão é descartada. Depois verificou RLS com o papel restrito: chamado próprio, contas publicadas locais, telemetria bruta inacessível, projeção autorizada de água, DELETE financeiro negado e revogação efetiva. A auditoria local/global permaneceu separada, metadata/IP/user-agent e DELETE foram negados, o tenant original ficou imutável e a exclusão daFK não promoveu histórico privado a global. Os chunks antigos/recentes e os valores em centavos foram preservados. Escrita no destino não alterou a origem; o executor reconheceu as36 migrations sem reaplicar privilégios.

A execução dirigida da restauração levou aproximadamente19 segundos, incluindo preparação; dump, restauração e verificações levaram aproximadamente9 segundos nesse conjunto pequeno. A suite completa posterior passou em58 segundos. Isso não estima recuperação de produção. O ensaio não cobre grandes volumes, chunks comprimidos, WAL/PITR, armazenamento externo nem recuperação de todo o servidor.

## Recuperação lógica com SQL038

Em 03/10/2026, o ensaio dirigido ampliado passou **2/2, sem skips**, em55,2 segundos sobre os bytes finais: uma restauração entre dois bancos do mesmo cluster e outra entre clusters físicos distintos. Foram usados somente containers descartáveis próprios em loopback5455/5456, PostgreSQL16 e TimescaleDB2.17.2. O identificador físico de cada cluster foi conferido contra sua conexão SQL; os identificadores da segunda restauração eram diferentes. Evidência local: `work/notification038-backup-frozen-green.log`. Esse resultado é dirigido, não uma execução integral da API ou da suíte de banco.

Cada origem recebeu bootstrap, as **38 migrations**, dados sintéticos e alertas/enqueue na mesma transação. O teste conferiu as **49 tabelas públicas**, os chunks antigo/recente, conteúdo do ledger e checksums, owners, RLS, policies, ACLs de banco/tabelas/colunas/helpers e definições de todas as funções `app_*`, `identity_*` e `notification_*`. A aplicação posterior do executor retornou lista vazia; nenhuma migration antiga foi reaplicada para reparar o destino. O transporte entre containers usou diretório temporário privado e SHA-256 igual na origem, no arquivo transferido e no destino. Arquivos customizados e dados privados foram removidos no `finally`.

As sete situações reais de entrega foram criadas pelas interfaces de SQL038: `pending`, `retry`, `inflight`, `delivered`, `cancelled`, `failed` e `no_destination`. O teste preservou oito eventos, sete entregas, contadores, disponibilidade, categorias, lease/token em andamento, alternativas ANY e requisitos ALL, gerações de origem e tombstones. O alerta LOW preservou seu evento sem criar webhook. Os estados não foram fabricados por UPDATE direto em `event_deliveries`.

Uma conexão restrita real reservou a entrega em andamento e foi encerrada antes do dump. Após restaurar, outra conexão não conseguiu revalidar ou concluir seu token antigo. O teste aguardou a expiração real da lease de20 segundos, reservou a mesma entrega com token novo, manteve a chave de idempotência e confirmou a segunda tentativa. O protocolo limpou o registro de backend morto recuperado; a origem permaneceu com seu token e estado originais. Não se restaura uma sessão PostgreSQL ativa a partir de uma linha de `notification_attempts`.

O destino independente começou sem os quatro papéis de runtime. Eles foram criados explicitamente como NOLOGIN/NOINHERIT, sem poderes administrativos, memberships ou ownership; papéis globais e senhas não vieram do dump de um banco. Depois do restore, o provisionador real configurou credenciais novas para `predioon_app`, `predioon_identity`, `predioon_broker_auth` e `predioon_notifications`. Conexões TCP reais comprovaram negação de leitura direta das cinco tabelas da fila e do ledger, negação de escrita/forja de tentativa e negação de criação de tabela temporária. Só notificações executou begin/claim/revalidate/complete/end; os outros runtimes não receberam esses helpers. A troca de senha037 continuou acessível somente à identidade.

Pausar ENERGY_CONSUMPTION depois da restauração cancelou o pending com origem ALL e preservou o retry com alternativa ELECTRICAL capturada em ANY. Retomar não reviveu o pending cancelado nem o tombstone WATER_TANK, cujo alerta fora criado com timestamp futuro permitido. Os eventos e witnesses permaneceram iguais aos da origem e rejeitaram UPDATE mesmo pelo owner. Reenfileirar o alerta terminal retornou seu evento original sem aumentar a fila.

Dois RED sustentam a ampliação: `work/notification038-backup-inventory-red.log` mostrou que o inventário anterior omitia os helpers `notification_*` após restauração real; `work/notification038-backup-database-acl-red.log` mostrou que o banco recém-criado conservava TEMP para PUBLIC e omitia os CONNECT explícitos dos runtimes. O inventário foi ampliado e a ACL do **banco novo** passou a ser preparada explicitamente, antes do restore. As ACLs dos objetos continuam sendo restauradas do arquivo; a comparação não descarta a diferença encontrada.

## Executar o ensaio

O recorte037 também foi ensaiado em 03/10/2026: suíte completa **26/26 sem skips**, com as flags reais, em21,4 segundos; log work/password037-db-full-verified.log. O dump/restauração dirigido passou1/1 em5,4 segundos, verificando **44 tabelas e37 migrations**. O helper privado de troca de senha restaurado ficou inacessível a app/broker, a identidade continuou sem UPDATE direto em users e a transição autorizada alterou o hash/revogou duas famílias sem afetar o peer nem a origem. Hashes dessa fixture SQL não exercitam Argon2; a confirmação criptográfica é testada na API. A evidência036 acima permanece histórica e não foi somada à037 para formar outra integral.

Requer Node24, pnpm10.17.1, Docker e dois containers PostgreSQL/Timescale de teste. As URLs administrativas e seus containers devem identificar os respectivos clusters; o teste compara identificadores físicos antes de criar bancos. A origem e o destino precisam ser **exclusivos do ensaio**: o provisionamento modifica os papéis e senhas globais de cada cluster. Não executar em paralelo com outros testes que alterem esses papéis, nem apontar ao banco demonstrativo ou a uma instalação pessoal. Exemplo PowerShell, com credenciais carregadas de armazenamento privado:

```powershell
$env:TEST_MIGRATIONS_DATABASE_URL = '<URL administrativa privada da origem descartável>'
$env:TEST_BACKUP_CONTAINER = '<container exclusivo da origem>'
$env:TEST_BACKUP_RESTORE_DATABASE_URL = '<URL administrativa privada do outro cluster descartável>'
$env:TEST_BACKUP_RESTORE_CONTAINER = '<container exclusivo do outro cluster>'
pnpm --filter @predioon/db exec node --import tsx --test test/backup-restore.test.ts
```

Somente `backup_src_<UUID>` e `backup_dst_<UUID>`, criados pelo teste, são removidos no `finally`, junto dos arquivos temporários. No cluster independente, os papéis recém-criados pelo teste também são removidos depois do banco; o teste recusa um destino que já contenha esses runtimes. O banco configurado não é copiado, semeado, restaurado ou excluído. Sem as variáveis da origem, ambos os casos são ignorados; sem as duas variáveis de recuperação, apenas o caso de cluster independente é ignorado. Exigir **2/2 sem skips** para anunciar o ensaio completo deste recorte. O CI que fornece somente as variáveis da origem comprova apenas a restauração no mesmo cluster.

## Preparar backup operacional

1. Registrar release/commit, versões PostgreSQL/Timescale, banco, owner e ambiente. Conferir `pnpm db:infra --check` e preservar os binários da versão validada para recuperação.
2. Usar `pg_dump` em formato customizado, com nome exclusivo, e copiar o arquivo para armazenamento protegido fora do container. Conferir códigos de saída, tamanho e SHA-256. Arquivo existente ou exit code zero não substituem restauração.
3. Guardar separadamente papéis globais do cluster, credenciais de runtime, chaves JWT, configuração/credenciais MQTT, certificados e ambientes. Um dump de um banco não contém todos esses elementos. Os dumps incluem dados privados, hashes e sessões; não pertencem ao Git.
4. Configurar armazenamento cifrado, retenção, cópia externa e alerta de falha conforme a instalação. Ainda não há serviço agendado de backup entregue pelo projeto.

Referência de comandos, substituindo os marcadores por container e nome novos:

```text
docker exec <container-banco> pg_dump -U predioon -d predioon --format=custom --file=/tmp/predioon-<data-hora>.dump
docker cp <container-banco>:/tmp/predioon-<data-hora>.dump <diretorio-protegido>/predioon-<data-hora>.dump
```

No PowerShell, conferir SHA-256 com `Get-FileHash -Algorithm SHA256 -LiteralPath '<arquivo>'`. Usar o mecanismo administrativo de autenticação da instalação; não colocar senhas em comandos, URLs impressas ou relatórios.

## Restaurar em destino separado

A sequência da extensão e a execução serial seguem a [documentação oficial de backup lógico do TimescaleDB](https://github.com/timescale/Tiger-Data-Docs/blob/main/src/content/docs/deploy/self-hosted/backup-and-restore/logical-backup.mdx).

1. Provisionar destino isolado com versões compatíveis e os mesmos nomes de owners/papéis. Criar `predioon_app`, `predioon_identity`, `predioon_broker_auth` e `predioon_notifications` como NOLOGIN/NOINHERIT/NOSUPERUSER/NOBYPASSRLS/NOCREATEDB/NOCREATEROLE/NOREPLICATION, sem memberships ou ownership. Provisionar senhas novas depois da validação dos objetos restaurados. O ensaio038 comprovou esse recorte em outro cluster; não recupera automaticamente todas as configurações globais de um servidor.
2. Criar banco **novo** com `createdb`. Se o nome existir, interromper e revisar o destino. Não acrescentar `--clean`, apagar banco existente ou restaurar sobre a origem.
3. Preparar a ACL do banco novo antes de expor os runtimes: revogar CREATE/TEMP de PUBLIC e dos quatro papéis e conceder somente CONNECT a esses papéis. A restauração sem `--create`, usada para um nome novo, **não restaura privilégios do próprio DATABASE**; preservar ACLs de tabelas/funções não resolve essa fronteira. Conferir a ACL efetiva e o owner com o registro da origem. Esse comportamento está documentado em [PostgreSQL16 — pg_restore](https://www.postgresql.org/docs/16/app-pgrestore.html). No banco novo, executar `CREATE EXTENSION IF NOT EXISTS timescaledb;` e `SELECT timescaledb_pre_restore();`.
4. Executar `pg_restore --exit-on-error -U <owner> -d <banco-novo> <arquivo.dump>` serialmente. Não usar `-j`, `--no-owner` ou `--no-acl` neste procedimento; os catálogos e as garantias de autorização precisam ser preservados.
5. Após sucesso, executar `SELECT timescaledb_post_restore();`. Falha torna o destino incompleto e fora de serviço: preservar diagnóstico e preparar outro destino limpo, sem anunciar sucesso parcial.
6. Com a conexão administrativa explicitamente apontada ao destino, executar `pnpm db:infra --check`. Conferir a release do backup; não editar checksums nem reaplicar SQL antigo. Atualização de release é uma etapa separada, ensaiada conforme [MIGRATIONS](MIGRATIONS.md).
7. Configurar/provisionar credenciais restritas conforme [CREDENCIAIS_BANCO](CREDENCIAIS_BANCO.md). Iniciar serviços inicialmente sem tráfego externo e sem controladores físicos.
8. Conferir dados, valores, chunks, histórico, owners, ACLs e RLS; executar prontidão, login, revogação e isolamento. Manter o worker parado até conferir origem/witnesses, estados e destino do webhook. Sessões de banco, PID e token recuperados não autorizam concluir uma tentativa antiga: usar conexão dedicada nova e aguardar a lease para uma nova reserva. Preservar a chave de idempotência e os estados terminais; não zerar tentativas, apagar witnesses, ressuscitar cancelled ou recriar eventos históricos. Definir tratamento de sessões, jobs e comandos recuperados. Comandos físicos antigos não podem ser reenviados por uma política genérica de recuperação.

Uma restauração pode recuperar um pending/inflight anterior a um efeito externo já realizado depois do backup. O receiver precisa respeitar a mesma chave de idempotência por uma retenção que cubra o intervalo de recuperação. O ensaio comprova preservação da chave e fencing no banco; não comprova deduplicação pelo provedor nem entrega exatamente uma vez. Conferir também o destino ausente e falhas terminais antes de liberar tráfego.

## Aceite e pendências

Registrar versão, hash do arquivo, volume, duração por fase, erros, verificações de acesso e responsável pelo aceite. Definir RPO, RTO e retenção após ensaio em cópia representativa; coordenar mudança de tráfego somente depois desse aceite, preservando a origem.

Permanecem pendentes armazenamento externo cifrado, agendamento/alertas, recuperação completa de configurações globais/credenciais/certificados, WAL/PITR, volume representativo, chunks comprimidos e ensaio com o provedor externo após perda de servidor. A recuperação lógica038 inclui fila e interfaces SQL, mas não executa o processo de HTTP nem atua em controladores físicos. O resultado não encerra sozinho a etapa operacional.
