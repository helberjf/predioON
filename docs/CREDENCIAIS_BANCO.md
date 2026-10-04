# Credenciais de banco por função

A API usa três conexões distintas; o worker de webhook usa uma quarta, exclusiva de notificações. Nenhuma credencial de runtime deve ser proprietária do banco, schema, tabela ou função, possuir `SUPERUSER`, `BYPASSRLS`, herança, replicação, criação de roles/bancos ou participação em outra role. A API verifica suas três identidades antes de abrir HTTP e LISTEN. Cada tentativa de webhook verifica a identidade efetiva da própria conexão dedicada antes de reservar uma entrega; reconexão não conserva autorização de uma tentativa anterior.

A validação compara a identidade do login registrada pelo PostgreSQL, o usuário da sessão e o papel ativo. Isso detecta uma conexão administrativa que tenha trocado de papel. O PostgreSQL permite alterar as identidades de sessão e execução em condições específicas; veja a [referência de identidades](https://www.postgresql.org/docs/16/functions-info.html#FUNCTIONS-INFO-SESSION) e o [usuário autenticado do backend](https://www.postgresql.org/docs/16/monitoring-stats.html#MONITORING-PG-STAT-ACTIVITY-VIEW).

| Variável | Role | Responsabilidade |
| --- | --- | --- |
| `DATABASE_URL_APP` | `predioon_app` | Consultas de negócio dentro do contexto transacional do usuário e das políticas RLS; readiness e LISTEN |
| `DATABASE_URL_IDENTITY` | `predioon_identity` | Leitura de contas/vínculos/condomínios/organizações; criação, rotação e revogação de sessões e refresh tokens |
| `DATABASE_URL_BROKER_AUTH` | `predioon_broker_auth` | Leitura das colunas necessárias de gateways, dispositivos, portões e estado do condomínio para autenticar/autorizar MQTT |
| `DATABASE_URL_NOTIFICATIONS` | `predioon_notifications` | Somente funções de início/fim de sessão, reserva, revalidação e conclusão de uma entrega; sem SELECT/DML direto, contexto arbitrário de tenant ou acesso a credenciais |
| `DATABASE_URL` | Proprietário administrativo | Schema, migrations, seed e provisionamento; a ingestão legada ainda usa esta conexão durante a transição |

Identidade precisa localizar a conta antes de haver um usuário autenticado, por isso suas políticas são específicas da role de serviço. Isso não concede acesso a dados de negócio, auditoria, telemetria, finanças ou alteração de papéis. A verificação de conta durante a rotação usa uma função restrita que bloqueia a linha e consulta seu estado, sem conceder escrita direta em `users`.

O autorizador MQTT consulta os hashes e relacionamentos de campo; não acessa senhas de pessoas, sessões nem operações de escrita. Os endpoints internos continuam exigindo o segredo compartilhado com o broker. Os aplicativos mobile e web nunca recebem nenhuma destas credenciais.

## Provisionamento

1. Aplicar as migrations da release pela conexão administrativa, através do ledger. A `015-api-runtime-roles.sql` cria as três roles da API; a `038-durable-alert-delivery.sql` cria e restringe `predioon_notifications`, removendo memberships nos dois sentidos e recusando ownership existente. As novas roles começam sem login; o SQL não contém senhas padrão. A 038 também impede executar seus helpers pela API, identidade ou broker.
2. Configurar as cinco URLs no ambiente administrativo, apontando para o mesmo servidor, porta e banco: owner e quatro roles exatas da tabela, com senhas distintas. Caracteres especiais nas senhas das URLs precisam de percent-encoding. URLs com parâmetros de startup `role`, `options` ou `session_authorization` são recusadas, inclusive com capitalização diferente.
3. Executar `pnpm db:provision-runtime`. O comando valida todas as URLs antes de alterar qualquer senha e confirma as alterações numa transação. Não imprime URLs, senhas nem comandos SQL gerados.
4. Iniciar a API somente com suas três URLs restritas, e o worker somente com `DATABASE_URL_NOTIFICATIONS`. O Compose não fornece owner ao worker nem à API; o setup fornece owner e a quarta URL somente ao comando administrativo de provisionamento. `NOTIFICATIONS_DB_PASSWORD` deve estar preenchida antes do rollout. A ingestão continua com sua conexão proprietária durante a transição.

O setup local e o bootstrap de produção chamam o provisionamento após o SQL. A partir da 038 não há modo que omita a quarta credencial: todas são validadas antes de abrir a conexão administrativa ou mudar uma senha. `.env.example` contém as cinco URLs locais; as senhas ilustrativas servem somente para desenvolvimento. `DATABASE_URL_NOTIFICATIONS` também é obrigatória em desenvolvimento/teste, sem fallback para owner ou URL implícita. Atualização não exige reset nem seed.

## Verificação

`/health/ready` precisa conseguir consultar as três conexões. Em caso de falha retorna 503 com estado genérico, sem mensagem interna do driver. Os testes de runtime exercitam login sem a conexão proprietária, recusa da role proprietária no startup, direitos negativos de cada credencial e ocultação de segredos em erros.

As importações da API usam `@predioon/db/runtime`, `@predioon/db/identity` ou `@predioon/db/broker-auth`. O worker usa exclusivamente `@predioon/db/notifications`, que cria clientes restritos com uma conexão por tentativa. O export principal de `@predioon/db` continua administrativo. Fronteiras recusam imports administrativos, relativos, internos, dinâmicos e transitivos no worker, além de dependências de ingestão/MQTT. Tipos `postgres.Sql` são permitidos; importar o construtor do driver como valor no worker é recusado. Clientes web/mobile não acessam qualquer entrypoint do banco.

O ledger é novamente protegido após migrations legadas que concedem privilégios amplos; as quatro roles de runtime não podem consultá-lo nem modificá-lo. Os testes cobrem URL forjada, ausência da quarta configuração, parâmetros de startup, identidade autenticada, memberships/ownership e privilégio do ledger. A prova SQL/worker usa um job CI com cluster próprio: criar somente um banco novo não isola alterações de senha dos papéis globais.

O bootstrap atual aplica o baseline versionado somente em banco vazio; o executor usa ledger e checksum para aplicar apenas pendências. Não usa `drizzle-kit push --force` para atualizar produção. Consulte [MIGRATIONS.md](MIGRATIONS.md) e o [rollout de notificações](DEPLOY.md#rollout-do-webhook-durável-038).

A separação da ingestão, inbox, comandos, scheduler e demais workers continua pendente. Restringir o worker de webhook não conclui a política de privilégio mínimo de todas as cargas. A integração e os testes reais da release precisam ser aprovados antes de usar esses arquivos em produção.
