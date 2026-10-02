# Credenciais de banco por função

A API usa três conexões distintas. Nenhuma delas deve ser proprietária do banco, schema, tabela ou função, possuir `SUPERUSER`, `BYPASSRLS`, criação de roles/bancos ou participação em outra role. O startup verifica essas condições antes de abrir HTTP e LISTEN.

A validação compara a identidade do login registrada pelo PostgreSQL, o usuário da sessão e o papel ativo. Isso detecta uma conexão administrativa que tenha trocado de papel. O PostgreSQL permite alterar as identidades de sessão e execução em condições específicas; veja a [referência de identidades](https://www.postgresql.org/docs/16/functions-info.html#FUNCTIONS-INFO-SESSION) e o [usuário autenticado do backend](https://www.postgresql.org/docs/16/monitoring-stats.html#MONITORING-PG-STAT-ACTIVITY-VIEW).

| Variável | Role | Responsabilidade |
| --- | --- | --- |
| `DATABASE_URL_APP` | `predioon_app` | Consultas de negócio dentro do contexto transacional do usuário e das políticas RLS; readiness e LISTEN |
| `DATABASE_URL_IDENTITY` | `predioon_identity` | Leitura de contas/vínculos/condomínios/organizações; criação, rotação e revogação de sessões e refresh tokens |
| `DATABASE_URL_BROKER_AUTH` | `predioon_broker_auth` | Leitura das colunas necessárias de gateways, dispositivos, portões e estado do condomínio para autenticar/autorizar MQTT |
| `DATABASE_URL` | Proprietário administrativo | Schema, migrations, seed e provisionamento; a ingestão legada ainda usa esta conexão durante a transição |

Identidade precisa localizar a conta antes de haver um usuário autenticado, por isso suas políticas são específicas da role de serviço. Isso não concede acesso a dados de negócio, auditoria, telemetria, finanças ou alteração de papéis. A verificação de conta durante a rotação usa uma função restrita que bloqueia a linha e consulta seu estado, sem conceder escrita direta em `users`.

O autorizador MQTT consulta os hashes e relacionamentos de campo; não acessa senhas de pessoas, sessões nem operações de escrita. Os endpoints internos continuam exigindo o segredo compartilhado com o broker. Os aplicativos mobile e web nunca recebem nenhuma destas credenciais.

## Provisionamento

1. Aplicar todas as migrations correspondentes à versão da API pela conexão administrativa. A `015-api-runtime-roles.sql` cria as credenciais restritas; as seguintes acrescentam capacidades e políticas exigidas pelos handlers migrados. Os scripts de setup usam `psql --single-transaction` a partir da migration 015 e o runner de migrations já envolve cada arquivo em uma transação. As novas roles começam sem login; o SQL não contém senhas padrão.
2. Configurar as quatro URLs no ambiente administrativo, apontando para o mesmo servidor e banco. Usar as três roles exatas da tabela e senhas distintas. Caracteres especiais nas senhas das URLs precisam de percent-encoding.
3. Executar `pnpm db:provision-runtime`. O comando valida todas as URLs antes de alterar qualquer senha e confirma as alterações numa transação. Não imprime URLs, senhas nem comandos SQL gerados.
4. Iniciar a API somente com as três URLs restritas. O Compose de produção já omite `DATABASE_URL` no ambiente da API; o bootstrap a fornece somente nos comandos administrativos.

O setup local e o bootstrap de produção chamam o provisionamento após os scripts SQL. As senhas dos exemplos locais são apenas para desenvolvimento. Em uma instalação existente, configurar as duas novas URLs e aplicar a migration antes de reiniciar a API; nenhum reset ou seed é necessário para esta mudança.

## Verificação

`/health/ready` precisa conseguir consultar as três conexões. Em caso de falha retorna 503 com estado genérico, sem mensagem interna do driver. Os testes de runtime exercitam login sem a conexão proprietária, recusa da role proprietária no startup, direitos negativos de cada credencial e ocultação de segredos em erros.

As importações da API usam `@predioon/db/runtime`, `@predioon/db/identity` ou `@predioon/db/broker-auth`. O export principal de `@predioon/db` continua administrativo e não deve entrar no processo HTTP. A verificação de fronteiras protege essa separação.

Esta entrega cobre o processo da API. A retirada da credencial proprietária da ingestão e a criação das permissões de cada worker fazem parte da separação das cargas; não estão concluídas por esta alteração. O bootstrap definitivo com migrations registradas também continua pendente.

O bootstrap atual ainda usa `drizzle-kit push --force` e reaplica os scripts históricos. Ele não é o fluxo definitivo de atualização de uma instalação em operação: os scripts iniciais recriam políticas anteriores antes das migrations seguintes. A etapa de implantação precisa conectar o runner registrado, aplicar somente migrations novas e validar a atualização sem sobrescrever schema ou reabrir políticas legadas.
