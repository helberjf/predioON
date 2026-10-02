# Backup e restauração do Prédio ON

## Evidência verificada

Em 02/10/2026, `packages/db/test/backup-restore.test.ts` criou dois bancos descartáveis num PostgreSQL 16 com TimescaleDB 2.17.2. O primeiro recebeu bootstrap, migrations 001–031 e dados sintéticos de dois condomínios. Um arquivo customizado de `pg_dump` foi restaurado serialmente no segundo banco.

O teste comparou conteúdo das 43 tabelas públicas, ledger, policies, privilégios de tabelas/colunas/funções, owners e definições dos helpers `app_*`. ACL explícita equivalente à ACL padrão é normalizada; nenhuma concessão é descartada. Depois verificou RLS com o papel restrito: chamado próprio, contas publicadas locais, telemetria bruta inacessível, projeção autorizada de água, DELETE financeiro negado e revogação do vínculo efetiva. Os chunks antigos/recentes e os valores em centavos foram preservados. Escrita no destino não alterou a origem; o executor reconheceu o ledger sem reaplicar migrations.

A execução local levou aproximadamente 8,3 segundos, incluindo preparação; dump, restauração e verificações levaram aproximadamente 4,2 segundos nesse conjunto pequeno. Isso não estima recuperação de produção. O ensaio não cobre grandes volumes, chunks comprimidos, WAL/PITR, armazenamento externo nem recuperação de todo o servidor.

## Executar o ensaio

Requer Node 24, pnpm 10.17.1, Docker e container PostgreSQL/Timescale de teste. A URL administrativa e o container devem identificar o mesmo cluster; o teste compara seu identificador físico antes de criar bancos. Exemplo PowerShell para o ambiente descartável desta sessão:

```powershell
$env:TEST_MIGRATIONS_DATABASE_URL = 'postgres://predioon:predioon@localhost:5439/predioon'
$env:TEST_BACKUP_CONTAINER = 'predioon-test-migrations'
pnpm --filter @predioon/db exec node --import tsx --test test/backup-restore.test.ts
```

Somente `backup_src_<UUID>` e `backup_dst_<UUID>`, criados pelo teste, são removidos no `finally`, junto do arquivo temporário do container. O banco configurado não é copiado, semeado, restaurado ou excluído. Sem as duas variáveis, o teste fica explicitamente ignorado; o workflow Platform verification fornece ambas para exigir a execução real.

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

1. Provisionar destino isolado com versões compatíveis e os mesmos nomes de owners/papéis. `predioon_app`, `predioon_identity` e `predioon_broker_auth` precisam existir sem superuser ou ownership. O teste usa o mesmo cluster e não comprova recriação dos papéis em outro servidor.
2. Criar banco **novo** com `createdb`. Se o nome existir, interromper e revisar o destino. Não acrescentar `--clean`, apagar banco existente ou restaurar sobre a origem.
3. No banco novo, executar `CREATE EXTENSION IF NOT EXISTS timescaledb;` e `SELECT timescaledb_pre_restore();`.
4. Executar `pg_restore --exit-on-error -U <owner> -d <banco-novo> <arquivo.dump>` serialmente. Não usar `-j`, `--no-owner` ou `--no-acl` neste procedimento; os catálogos e as garantias de autorização precisam ser preservados.
5. Após sucesso, executar `SELECT timescaledb_post_restore();`. Falha torna o destino incompleto e fora de serviço: preservar diagnóstico e preparar outro destino limpo, sem anunciar sucesso parcial.
6. Com a conexão administrativa explicitamente apontada ao destino, executar `pnpm db:infra --check`. Conferir a release do backup; não editar checksums nem reaplicar SQL antigo. Atualização de release é uma etapa separada, ensaiada conforme [MIGRATIONS](MIGRATIONS.md).
7. Configurar/provisionar credenciais restritas conforme [CREDENCIAIS_BANCO](CREDENCIAIS_BANCO.md). Iniciar serviços inicialmente sem tráfego externo e sem controladores físicos.
8. Conferir dados, valores, chunks, histórico, owners, ACLs e RLS; executar prontidão, login, revogação e isolamento. Definir tratamento de sessões, jobs e comandos recuperados. Comandos físicos antigos não podem ser reenviados por uma política genérica de recuperação.

## Aceite e pendências

Registrar versão, hash do arquivo, volume, duração por fase, erros, verificações de acesso e responsável pelo aceite. Definir RPO, RTO e retenção após ensaio em cópia representativa; coordenar mudança de tráfego somente depois desse aceite, preservando a origem.

Permanecem pendentes armazenamento externo cifrado, agendamento/alertas, perda completa do servidor/objetos globais, WAL/PITR, volume representativo e recuperação dos workers duráveis quando implementados. O ensaio entregue comprova recuperação lógica da estrutura atual e de sua autorização; não encerra sozinho a etapa operacional.
