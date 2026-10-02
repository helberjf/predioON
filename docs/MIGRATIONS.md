# Migrações, preparação e recuperação do banco

Este documento descreve o executor presente no código. Ele prepara instalações novas e atualiza bancos com histórico válido. Não declara concluídas as demais etapas da plataforma nem oferece adoção automática de bancos legados sem histórico.

## Comandos e responsabilidade

| Comando | O que faz | Uso de credencial |
|---|---|---|
| `pnpm db:wait` | Aguarda uma consulta simples ao PostgreSQL ter sucesso | `DATABASE_URL` |
| `pnpm db:bootstrap` | Cria o baseline em banco vazio; valida e preserva baseline existente | Administrativa |
| `pnpm db:infra --check` | Confere baseline, histórico, checksums e pendências, sem aplicar SQL de migration | Administrativa; somente consultas e lock de sessão |
| `pnpm db:infra` | Aplica somente migrations pendentes e registra cada confirmação | Administrativa |
| `pnpm db:provision-runtime` | Configura login/senha das três roles restritas conforme as URLs do ambiente | Administrativa |
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

O ledger tem RLS sem policies de runtime. O runner revoga privilégios de `PUBLIC`, `predioon_app`, `predioon_identity` e `predioon_broker_auth`, inclusive depois de scripts legados que concedem permissões amplas sobre tabelas. A conta administrativa continua capaz de administrá-lo; portanto, proteger essa credencial é parte do controle de mudanças.

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
| `DATABASE_URL` | Bootstrap, migrations, seed e provisionamento; a ingestão ainda a usa durante a transição |
| `DATABASE_URL_APP` / `predioon_app` | Operações HTTP de negócio com contexto de usuário e RLS |
| `DATABASE_URL_IDENTITY` / `predioon_identity` | Autenticação e sessões |
| `DATABASE_URL_BROKER_AUTH` / `predioon_broker_auth` | Autenticação/autorização do broker |

As quatro URLs de provisionamento devem apontar ao mesmo servidor/banco e usar os papéis esperados. A API não recebe a conexão proprietária em produção. A separação da credencial da ingestão e dos futuros workers continua pendente no plano aprovado; não considerar todos os runtimes restritos por causa da separação da API.

## Testes em banco isolado

Exemplo PowerShell, na raiz do repositório. O nome e a porta devem estar livres; se já estiverem usados, escolha outros e ajuste **todas** as URLs. Não reutilize o container da instalação cotidiana ou de outro teste em execução.

```powershell
docker run --detach --name predioon-db-check --publish 127.0.0.1:5439:5432 --env POSTGRES_USER=predioon --env POSTGRES_PASSWORD=predioon --env POSTGRES_DB=predioon --env TIMESCALEDB_TELEMETRY=off timescale/timescaledb:2.17.2-pg16
$env:DATABASE_URL = "postgres://predioon:predioon@localhost:5439/predioon"
$env:DATABASE_URL_APP = "postgres://predioon_app:predioon_app@localhost:5439/predioon"
$env:DATABASE_URL_IDENTITY = "postgres://predioon_identity:predioon_identity@localhost:5439/predioon"
$env:DATABASE_URL_BROKER_AUTH = "postgres://predioon_broker_auth:predioon_broker_auth@localhost:5439/predioon"
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
pnpm test
```

As senhas acima são apenas do container descartável local. `TEST_MIGRATIONS_DATABASE_URL` precisa permitir criar/remover bancos temporários. A suíte verifica instalação nova, concorrência, rollback, checksums, recusa de legado, preservação de grants, privilégio do ledger, consulta sem alterações e CLI da release atual. Os testes de aplicação não substituem verificação de equipamento físico.

O inicializador Windows possui teste isolado com ferramentas simuladas:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-start-local.ps1
```

Ele cobre retomada de infraestrutura parada, bloqueio por pendência/legado, falha de infraestrutura, setup sem seed implícito e seed explicitamente pedido. Esse teste não instala dependências, não executa Docker nem altera banco real. A suíte PostgreSQL deve ser executada separadamente. Ao terminar, encerre somente os containers descartáveis identificados para esse ensaio e remova as variáveis do terminal ou feche esse terminal antes de voltar à instalação habitual.
