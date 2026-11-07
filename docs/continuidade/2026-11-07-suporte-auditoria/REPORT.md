# Auditoria estática da latência de support-access/mine

Data: 2026-11-07. Estado: **investigação de código concluída; medições propostas não executadas**.
Escopo autorizado: leitura da fonte congelada e autoria deste relatório em scratch. Nenhum banco, processo Node, serviço, fonte congelada ou arquivo do repositório foi alterado por esta auditoria.

## Decisão

Ainda não há evidência suficiente para atribuir a diferença de latência ao envelope MFA nem para escolher uma alteração SQL ou um índice. Preservar a correção de segurança e medir primeiro. Não aplicar migration independente: a composição MFA já utiliza o candidato 068 e a numeração deve ser reconciliada com main no eventual rollout.

A amostra HTTP de 11.672 ms merece investigação prioritária, mas o limite de contenção de 30 s do teste não é meta de produção. Não declarar prontidão de produção a partir de 14 testes dirigidos ou das 226 verificações de regressão existentes.

## Evidência de entrada

Fonte inspecionada: `work/mfa-support-read-v2-fixed-qa-20261107/source`.
Composição preparada: SHA-256 `72303310e31c365ef9e2b43ccde9007c53d3e85d74d33c2174d15ad95ac16fde`.
Baseline preparado: `5997c4708f7ca76abc771d4c429d680f354711190527b4b434f9bebc76803057`.
Base canônica da composição: `53c4c70dcd24f1045fad420fbce36757fd3753a2`.
Checkpoint publicado de referência: `7d157e4dfeea321f5a51f8d16637dd856ad87090`.
A fonte isolada contém o candidato 068; isso não significa que a migration esteja publicada/aplicada em produção.

Evidência publicada: `predioON/docs/evidencias/mfa-support-read-2026-11-07.json`, SHA-256 `86a80f4257c3740d9fd0374ad2ad9592143ffb7afb9c7a5361a1e6c9b43769fb`.

| Observação HTTP, 200 itens | Baseline | Correção MFA |
| --- | ---: | ---: |
| grants200 | 1.739 ms | 2.180 ms |
| mine200 | 3.947 ms | 11.672 ms |
| grants200-resource | 752 ms | 902 ms |

São amostras únicas, em execuções distintas, com banco descartável limitado a 1 CPU/384 MiB. A medição no teste envolve fetch, resposta e JSON, não apenas SQL; login ocorre antes. Não há EXPLAIN, série temporal, variância, decomposição por fase ou ordem alternada. Portanto, a tabela não estabelece regressão causal, p95, efeito do cache, custo exato de RLS nem adequação a carga real.

A primeira tentativa do harness teve um timeout genérico de 5 s no cenário de página grande; o rótulo não identifica qual das duas rotas falhou. A v2 ampliou somente a contenção HTTP desse cenário a 30 s e adicionou duração/rótulo. Isso não corrige performance nem altera as asserções funcionais.

O cenário tem 205 concessões no condomínio alvo (quatro combinações temporais + 201 adicionadas), 202 elegíveis em /mine antes do limite 200, mesmo condomínio e vencimentos empatados. Há uma concessão de outro usuário em outro condomínio. A maioria das concessões usa telemetry:read; uma possui recurso device inexistente. Os nomes de condomínio são permitidos pela descoberta por concessão ampla válida. Essa distribuição é boa para validar limite/ordem, mas não representa todos os volumes e escopos de produção.

## Caminho efetivo no código

Os caminhos abaixo são relativos à fonte congelada; os hashes dos arquivos estão em `source-inventory.json`.

1. `apps/api/src/auth/middleware.ts:19`: autentica token e resolve a identidade/sessão; `:41` verifica o estado operacional MFA. HTTP inclui esse trabalho.
2. `apps/api/src/modules/support-access/routes.ts:208`: /mine usa userId da identidade autenticada. A consulta mantém usuário, revogação, relógio de parede, LEFT JOIN de buildings, ordenação e limite 200.
3. `apps/api/src/auth/middleware.ts:94` e `packages/db/src/context.ts:33`: abre transação predioon_app, define app.user_id/app.role/app.session_id localmente e adquire trava compartilhada de funcionalidades.
4. `packages/db/src/features.ts:7`: pg_advisory_xact_lock_shared(814772,1). Uma espera nessa trava ou no pool entra na duração HTTP, mas não é explicada pelo plano da consulta final.
5. `apps/api/src/auth/mfa-read.ts:40`: CASE chama app_require_session_mfa() no mesmo statement que a consulta protegida. O envelope agrega no máximo 200 linhas em JSONB e ordena por expiresAt/id; o seletor interno ordena pelo timestamptz/id. `:49` valida o resultado e decodifica cada item com Zod.
6. `apps/api/src/http/sql-time.ts:8`: expiresAt é texto ISO UTC com milissegundos. Manter essa representação, a semântica nullable de buildingName e o desempate UUID.
7. `infrastructure/068-platform-mfa-required.sql:43`: o guard STABLE/SECURITY DEFINER consulta exigência administrativa a partir do contexto, retorna true para MFA opcional ou valida sessão/fator e lança PMF01/PMF02 quando necessário. Não recebe ator do corpo HTTP.

### RLS e helpers efetivos

| Objeto | Definição efetiva relevante | Trabalho visível no código |
| --- | --- | --- |
| support_grants SELECT | 021:253 | tenant ativo AND (capacidade global support:grant OR capacidade local support:read OR própria concessão não revogada/futura e papel PLATFORM_SUPPORT) |
| Remoção do antigo ALL | 053:11 | Retira support_grants_write FOR ALL; cria INSERT/UPDATE separados. Não somar o antigo ALL ao SELECT efetivo. |
| app_rbac_tenant_active | 014:251 | buildings + organizations + users ativos |
| app_rbac_platform_role_at | 021:21 | users/roles e role_bindings com janela válida |
| app_has_capability / _at | 021:99 / :43 | tenant, catálogo, role_bindings/teams, memberships, ou support_grants do usuário/condomínio/capacidade/recurso |
| app_has_global_capability / _at | 021:104 / 024:10 | papel PLATFORM_ADMIN e permissões globais; a versão024 acrescenta health à whitelist |
| buildings_capability_read | 016:56 | app_can_discover_building(id) |
| app_can_discover_building | **019:55** | capacidade global/local, vínculos por recurso ou concessões; a versão019 substitui016 e valida pertencimento do recurso |
| app_discovery_resource_belongs | 019:4 | null/null é amplo; recursos concretos exigem existência no mesmo condomínio; é helper privado, não invocar diretamente como app |
| app_require_session_mfa | candidato068:43 | exigência da identidade administrativa e prova vigente da sessão |

Esses leitores de autorização são STABLE SECURITY DEFINER. O corpo SQL pode consultar relações com os privilégios do proprietário controlado; isso **não prova recursão de RLS**. A instalação exata deve conferir owner, rolsuper/rolbypassrls e relforcerowsecurity antes de interpretar um plano. A migration015 exige runtime sem superusuário, BYPASSRLS, herança, memberships ou propriedade; o cliente runtime também verifica a identidade real do backend.

A política de support_grants usa expires_at > statement_timestamp(), enquanto a rota usa expires_at > clock_timestamp(). Os dois filtros são deliberadamente distintos. Não substituir relógios, volatilidade ou snapshots para obter um plano melhor.

### Índices relevantes encontrados estaticamente

- support_grants tem PK UUID id e `support_grants_user_building_idx(support_user_id,building_id)`, ambos em014:138–152.
- Não foi encontrado outro índice de support_grants nas migrations001–068. Não há índice dedicado a expires_at/id ou à combinação de capacidade/revogação nesse conjunto de fontes; o catálogo real continua sendo a confirmação necessária.
- role_bindings tem índices separados em building_id, user_id e team_id (014:134–136), além da PK.
- Lookup do tenant, usuário e sessão pode usar suas PKs; verificar os índices realmente instalados e estatísticas, sem inferir automaticamente que o planner os seleciona.
- O índice composto existente pode reduzir candidatos por usuário/condomínio, mas não resolve sozinho a ordenação pessoal por expires_at/id nem elimina avaliações de políticas ou inspeções por capability.

## Hipóteses sustentadas pelo código, ainda não medidas

| Hipótese | Por que investigar | O que confirma/refuta |
| --- | --- | --- |
| H1: autorização repetida por concessão | support_grants_read chama leitores de tenant/capacidade/papel; support:read exige busca adicional em concessões, enquanto o cenário contém telemetry:read | linhas examinadas, filtros, loops e perfil dos helpers com mesma identidade; não assumir ordem de avaliação dos OR |
| H2: descoberta de building repetida | LEFT JOIN está sujeito à política de buildings; descoberta019 pode voltar a concessões e consultar capacidades/recurso | tipo de join, loops da leitura de buildings, Memoize se houver, plano/tempo guardado do helper de descoberta |
| H3: envelope altera trabalho/plano | CASE + JSONB + aggregate ORDER BY + decodificação são diferenças reais; SQL interno continua igual | plano completo atual, custo da agregação, sort/spill, microtempo do guard e decode; comparar variantes futuras mantendo o guard |
| H4: candidatos/ordenação crescem com volume | somente o índice usuário/condomínio está declarado; os 200 itens podem demandar filtrar mais linhas | actual rows, Rows Removed, scans e sorts para múltiplas cardinalidades/escopos |
| H5: custo fora da consulta final | HTTP inclui identidade, aquisição de conexão, contexto, trava, transporte e JSON | spans separados, pg_stat_activity/wait_event no PID próprio, duração de lock e pool, CPU/memória/cgroup no período |

STABLE permite certas otimizações, mas não é promessa de memoização de todo helper. A ordem textual de AND/OR tampouco garante curto-circuito numa ordem específica. [Volatilidade PostgreSQL](https://www.postgresql.org/docs/16/xfunc-volatility.html), [avaliação de expressões](https://www.postgresql.org/docs/16/sql-expressions.html#SYNTAX-EXPRESS-EVAL).

clock_timestamp é um valor volátil: não tratar o predicado de relógio de parede como limite constante de index scan. Um futuro índice ainda poderia ajudar outros predicados/ordenação, a verificar no plano; não transformar o relógio em STABLE para forçar seu uso. [Volatilidade PostgreSQL](https://www.postgresql.org/docs/16/xfunc-volatility.html).

## Observação funcional adicional: precisão da ordenação

Há uma possível divergência determinística de ordenação, separada da latência: o seletor interno ordena expires_at como timestamptz, mas o agregado reordena pelo campo expiresAt formatado somente até milissegundos. O schema não limita o timestamp a essa precisão (014:146 e packages/db/src/schema-rbac.ts:156). Dois vencimentos distintos dentro do mesmo milissegundo viram empate no agregado e podem ser invertidos por id. Exemplo: id baixo expira em .000900 e id alto em .000100; a ordem interna ASC é alto/baixo, enquanto a chave ISO com MS empata e o agregado pode resultar baixo/alto.

O mesmo cuidado se aplica ao createdAt DESC de /grants. O teste atual utiliza timestamps iguais, não distintos no mesmo milissegundo. Não foi executada reprodução PostgreSQL nesta auditoria. Antes de considerar a ordenação totalmente preservada, adicionar teste com microssegundos, IDs em ordem adversa e ambos os endpoints. Se confirmado, o ajuste mínimo é preservar a chave temporal completa apenas para ordenar dentro do SQL e excluí-la do DTO, ou preservar ordinal gerado pela ordenação original; a escolha precisa revisão do helper e dos decoders strict. Não reduzir precisão armazenada, mudar DTO para expor campo interno ou retirar o guard. Nenhum patch foi aplicado.

## Protocolo de medição proposto, não executado

### 1. Preparação e identidade

- Root executa serialmente, depois da bateria MFA que já está em andamento. Respeitar o preflight de memória/identidade vigente. Não iniciar outro serviço nem reiniciar computador, WSL ou Docker.
- Usar exclusivamente a fixture oficial `packages/db/test/fixtures/runtime-services.ts` e o launcher atestado; ela exige TEST_INGEST_* completo, identidade integral de container/sistema PostgreSQL, banco UUID descartável, ausência de .env real e restauração de papéis/configurações em finally.
- Preparar nova cópia isolada e inventariada; não editar o fixed/baseline congelado. Revalidar checksums das migrations, incluindo o candidato068. Nenhuma aplicação a banco existente de usuário.
- Owner somente cria massa fictícia, inspeciona catálogo e limpa a fixture; **toda medição da consulta da aplicação usa conexão predioon_app autenticada de fato**, confirmada por verifyRestrictedDatabaseRole. SET ROLE de um owner não substitui essa confirmação.
- Login HTTP real e sessão ativa para staff PLATFORM_SUPPORT/MFA opcional; /auth/me deve confirmar not-required. Segundo cenário com ADMIN que também tem concessões próprias e prova MFA satisfeita. Para este segundo cenário, completar o fluxo MFA real da aplicação quando o harness suportar, ou registrar explicitamente se a prova/fator continuar sintética como nos testes existentes; nunca chamar isso de teste TOTP completo.
- Contexto userId/role/sessionId deve vir da identidade resolvida pelo servidor da fixture, não de IDs inventados pelo SQL de benchmark. Manter os valores em memória e fora dos logs. Não publicar token, senha, segredo de fator, URI privada ou parâmetros com identidade real.
- Registrar versão real de PostgreSQL/extensões, settings relevantes, CPU/memória, quantidade e distribuição de dados, ledger, hashes de fonte, horários, estado de RLS/owners/ACLs/índices, estatísticas e plano. A documentação PG16 abaixo é referência de sintaxe; conferir compatibilidade da versão instalada.
- Capturar estatísticas existentes antes de mexer nelas. Se houver necessidade de ANALYZE nas tabelas fictícias recém-carregadas, fazer isso pelo owner somente nessa fixture e marcar a série separada; não comparar antes/depois como se fossem o mesmo cenário.

### 2. Massa controlada e repetição

- Primeira série reproduz a distribuição205/202 do teste; segunda cobre0,1,20,200 itens elegíveis; depois escalar candidatos revogados/expirados e condomínios distintos com limites de tempo/memória.
- Incluir concessões de outro usuário, tenant/organização inativo, usuário/papel inativo, recurso válido/inexistente e várias capabilities. Manter vencimentos suficientemente distantes durante medições; testes de fronteira temporal são outra série funcional.
- Começar com uma execução de abertura de conexão e três aquecimentos, marcados como tal, depois pelo menos10 repetições seriais por cenário. Registrar todas, inclusive timeout, sem excluir outliers silenciosamente. Publicar mediana, mínimo/máximo e distribuição; com10 amostras não reivindicar p95 confiável de produção.
- Para uma futura variante otimizada, alternar ordem AB/BA com semente registrada em pelo menos10 pares, mantendo mesmas identidades, massa e limites. Ambas variantes precisam conservar RLS e o guard MFA no statement. Não reintroduzir a leitura sem guard no produto como “baseline de performance”.
- “Primeira conexão do processo” e “cache aquecido” são rótulos honestos; não chamar uma medição de cold-cache sem prova. Não limpar caches do host, desalojar cache compartilhado ou reiniciar serviços.
- Parar após o primeiro timeout inesperado para inspeção, sem acionar tempestade de retries. Timeout HTTP30s de contenção e statement_timeout25s apenas para o harness de observação, nunca como meta/SLA. Se não bastarem, conservar o timeout como resultado e revisar antes de ampliar.

### 3. Captura do plano sob RLS/MFA

Dentro da transação aberta pela conexão predioon_app validada, reproduzir withUserContext e a trava de funcionalidades antes da consulta. Os três valores abaixo devem ser bind parameters do driver obtidos da identidade autenticada; não substituir por texto interpolado:

```sql
-- Fragmentos para o harness revisado, NÃO um script psql pronto para execução.
SET LOCAL statement_timeout = '25s';
SET LOCAL lock_timeout = '2s';
SET LOCAL row_security = on;
SELECT set_config('app.user_id', $1, true),
       set_config('app.role', $2, true),
       set_config('app.session_id', $3, true);
SELECT pg_advisory_xact_lock_shared(814772, 1);
```

Medir separadamente pool/contexto/trava; cada medição termina com rollback/finally e pool fechado. A transação de observação deve ser read-only quando compatível com o harness da leitura; não elevar o isolamento da rota para mascarar diferenças.

Capturar primeiro um plano não executado, depois o executado, com **o mesmo usuário da rota** vinculado a $1. Preservar a consulta extraída da composição, incluindo aliases, clocks, limites e ordenações:

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS, TIMING OFF, FORMAT JSON)
SELECT CASE WHEN public.app_require_session_mfa() THEN COALESCE((
  SELECT jsonb_agg(to_jsonb("mfa_read_row")
                   ORDER BY "mfa_read_row"."expiresAt", "mfa_read_row"."id")
  FROM (
    SELECT g.id, g.building_id AS "buildingId", b.name AS "buildingName",
           g.capability, g.reason,
           to_char(g.expires_at AT TIME ZONE 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "expiresAt"
    FROM support_grants g
    LEFT JOIN buildings b ON b.id = g.building_id
    WHERE g.support_user_id = $1
      AND g.revoked_at IS NULL
      AND g.expires_at > clock_timestamp()
    ORDER BY g.expires_at, g.id
    LIMIT 200
  ) AS "mfa_read_row"
), '[]'::jsonb) ELSE NULL END AS rows;
```

Executar o mesmo SELECT sem EXPLAIN em repetições separadas e consumir/validar o DTO completo; EXPLAIN ANALYZE realmente executa a consulta, adiciona instrumentação e não mede o transporte completo do resultado. Uma amostra adicional TIMING ON pode ajudar localizar nós, mas não misturar seus tempos com a série principal. Guardar planos JSON sanitizados e hashes. [EXPLAIN PostgreSQL](https://www.postgresql.org/docs/16/sql-explain.html).

Registrar actual/estimated rows, loops, scans, índice escolhido, filtro RLS, filtros removidos, tipo de join, sort method/memory/temp blocks, planning/execution time e buffers. Verificar se LIMIT é aplicado antes do agregado, se o guard tem o comportamento esperado e se funções internas aparecem opacas. Buffers são cumulativos por nó; não somar pai e filhos como trabalho independente.

### 4. Decomposição sem enfraquecer autorização

- Instrumentação somente na cópia do harness, sem publicar hooks de produção: spans de verify/resolveIdentity, espera de conexão, GUCs, feature-lock, SQL final, decode/Zod, res.json, fetch+parse. Não mudar a query para “medir” fora das políticas.
- Uma consulta `SELECT public.app_require_session_mfa()` sob o mesmo contexto estima o guard isolado, mas não prova que todos os custos sejam aditivos.
- `SELECT CASE WHEN public.app_require_session_mfa() THEN public.app_can_discover_building($1) ELSE NULL END` permite medir o helper público para um condomínio da fixture, sem chamar o helper privado de existência.
- Similarmente, proteger a chamada pública app_has_capability(building,'support:read') com CASE MFA, mantendo identidade e catálogo; comparar permissões próprias/negadas. Esses microtestes preservam RLS das relações que acessam segundo suas definições efetivas, mas não substituem o plano integral.
- Se o plano superior não expuser SQL interno dos SECURITY DEFINER, registrar a limitação. auto_explain/log_nested_statements só seria uma segunda experiência privilegiada, isolada e revisada, com logging de parâmetros desativado e restauração garantida; não dar superusuário ao runtime nem habilitar globalmente neste computador. A extensão tem sobrecusto e controles restritos. [auto_explain PostgreSQL](https://www.postgresql.org/docs/16/auto-explain.html).
- Uma série com concorrência só vem após a série1 ser compreendida e com orçamento de memória suficiente; este relatório não autoriza carga paralela ilimitada.

### 5. Critérios para escolher a menor alteração

1. Se SQL é rápido e o tempo fica na trava/pool/identidade, resolver essa fase; índice em support_grants não é a ação justificada.
2. Se predominam scans por capacidade no helper, avaliar somente um índice apropriado a usuário/condomínio/capacidade/revogação em cópia descartável, medindo tamanho/custo de escrita e repetindo os testes de autorização. Ainda não há DDL recomendado.
3. Se predominam seleção/ordenação pessoal, avaliar somente índice coerente com usuário/expiração/id e a seletividade de revogados. Manter o predicado volátil como está; não prometer range scan nem page limit pushdown sem plano.
4. Se predominam chamadas redundantes de autorização, uma refatoração deve preservar tenant ativo, grants temporais, recursos, catálogo vivo e snapshots; mero reordenamento textual de OR não constitui solução comprovada. Não trocar a função para IMMUTABLE nem remover política.
5. Se o agregado/decode domina, otimização do envelope exige os testes de corrida e lista vazia do helper, ordenação/DTO e casos MFA. Não trocar por guard em statement anterior, que reabre a janela protegida.

Qualquer candidato futuro precisa demonstrar resultado exatamente igual no mesmo cenário autorizado, negativas equivalentes e séries repetidas melhores sem regressões funcionais. Reexecutar todos os14 TAP dirigidos atuais, os cenários temporais/RLS relevantes e as regressões selecionadas; preservar o inventário de fontes/cleanup. Revisar a sequência de migrations com a composição MFA cumulativa antes de commit/push.

## Entrega e pendências

Concluído nesta auditoria: rastreamento efetivo de RLS/descoberta/guard/índices, distinção entre observação e hipótese, e protocolo concreto de planos/repetições.
Pendente: executar o protocolo em fixture atestada, coletar planos e séries, escolher eventual mudança mínima, provar equivalência e validar sob carga representativa.
Não foi criado script de execução SQL ou benchmark para evitar que fragmentos sem a identidade real e o preflight sejam usados isoladamente. O utilitário local build-inventory.py somente leu/validou hashes e escreveu os metadados desta auditoria. Não houve execução de teste, EXPLAIN, alteração SQL ou alegação nova de aprovação funcional nesta auditoria.
