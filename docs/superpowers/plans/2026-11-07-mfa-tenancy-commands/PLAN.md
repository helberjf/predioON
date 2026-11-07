# Plano restrito: seis PATCHs de estrutura com MFA

**Execução do primeiro lote em07/11:**35 TAP dirigidos e57 de regressão passaram; [prova e limitações](../../../evidencias/mfa-tenancy-commands-2026-11-07.json). Os casos cobrem perda de fator/prova nos seis PATCHs, missing, no-op, lock real e trigger em equipe, permissões e autorrevogação. Promoção, perda/mudança de prédio do alvo após espera, conflitos concorrentes e demais combinações seguem pendentes. O desenho abaixo preserva a revisão anterior e não representa aceite de toda a matriz.

Desenho estático, não implementado nem executado. Fonte candidata `work/mfa-features-read-v2-fixed-qa-20261107/source`, prepared SHA-256 `b0fe96cd2789f39ead9c90a972c4296cc7de2ba38142a8aa6f36eabd4a147685`, 1.026 arquivos. A execução das regressões dessa fonte pertence ao coordenador e não é resultado deste plano. `inventory-pins.json` fixa os arquivos examinados. Não houve alteração em produto, migrations, políticas, serviços ou banco.

## Escopo e sequência de entrega

Somente PATCH `/v1/tenancy/blocks/:id`, `/units/:id`, `/teams/:id` e os respectivos `/:id/status`. Todos usam `apps/api/src/modules/tenancy/routes.ts`; os auxiliares comuns são `edit` (linha375) e `setStatus` (419). Não incluir criação, revogação de vínculos, convites, usuários, funcionalidades, suporte ou outros domínios.

1. Escrever teste comum baseline/fixed, inicialmente fora do glob principal, e congelar hash. A primeira execução precisa demonstrar a fronteira e distinguir falha de segurança de falha de fixture.
2. Implementar apenas o caminho dos seis PATCHs no arquivo de rotas. Preferir auxiliares privados nesse arquivo; não criar executor geral de callbacks SQL. `recordAudit`, policies e os helpers MFA compartilhados ficam intactos.
3. Conferir tipos da API e do teste comum, executar RED no baseline e GREEN no candidato em árvores distintas, depois o `tenancy-edit.test.ts` original e a seleção de regressão explicitamente aprovada.
4. Congelar delta, evidências e mapa de limites. Não aplicar068 na main por consequência desse lote.

Arquivos previstos: um produto (`apps/api/src/modules/tenancy/routes.ts`) e um teste novo (`apps/api/test/platform-mfa-tenancy-commands.test.ts`); fixture adicional somente se o inventário de atores justificar. Nenhuma nova migration, função SQL de produto, role, grant ou policy é necessária para o protótipo proposto. Se a prova do statement não funcionar, voltar ao desenho, sem acrescentar um helper VOLATILE às cegas.

## O que o código já protege

| Ponto | Evidência na fonte | Decisão |
| --- | --- | --- |
| Identidade e MFA HTTP | `auth/middleware.ts:34–43` exige estado operacional; `94–100` passa SID e traduz PMF | Preservar. Esse gate não representa o snapshot de cada comando posterior |
| Contexto e bloqueio de funcionalidades | `packages/db/src/context.ts:33–43`; `middleware.ts:97`; `packages/db/src/features.ts:8` | Role app não-owner e GUCs da requisição, com lock compartilhado de funcionalidades. Não trocar pool/isolation nem inventar SID |
| Policies de escrita | `infrastructure/014-rbac-tenancy.sql:355,360,373` | `blocks_write`, `units_write`, `teams_write` são FOR ALL com USING e WITH CHECK de `app_has_capability`. O UPDATE real já reavalia a capacidade; não substituir nem enfraquecer RLS |
| Semântica de capacidade | `021-authorization-time-windows.sql:43–78,99–102` | SQL STABLE usa relógio do statement, memberships/bindings/equipe vigentes. PLATFORM_ADMIN global, sozinho, não fornece as capacidades locais de editar estrutura |
| MFA no banco | `068-platform-mfa-required.sql:43–66,95–102,188–195` | A guarda já existe, mas não há policy MFA em blocks/units/teams. As seis policies candidatas de outras tabelas não cobrem estes comandos |
| Visibilidade inicial | `tenancy/routes.ts:381–384,427–430` | Registro fora da projeção inicial é404. Registro próprio visível ao residente, mas sem manage, é403. Manter essa distinção |
| Status e espera | `tenancy/routes.ts:431–437` | `FOR UPDATE` antecede o UPDATE. O UPDATE seguinte tem uma nova oportunidade de RLS; o ramo sem alteração usa somente SELECT e não tem essa oportunidade de escrita |
| Auditoria | `audit/repo.ts:14–27`; migrations036/041 | `edit` audita depois do UPDATE; `setStatus` audita antes para permitir retirar o acesso da própria equipe. As duas operações fazem rollback juntas |
| DTO | `tenancy/routes.ts:41–43,62–72` | Block:5 campos; unit:6; team:5. Sem `updatedAt`, metadata, IP, userAgent ou campos administrativos novos |

O UPDATE de `setStatus`, por ser outro statement depois do lock, mantém a proteção de capacidade fornecida pelas policies. **Isso não significa que o próprio SELECT FOR UPDATE reavalie todas as tabelas de autorização depois da espera**, nem que a MFA esteja presente na policy. `edit` atualmente só espera o lock implícito do próprio UPDATE; esse detalhe exige tratamento específico para testar uma decisão posterior à espera do alvo.

## Base PostgreSQL e limites do desenho

O Compose examinado usa PostgreSQL16. A documentação explica que READ COMMITTED permite snapshots distintos entre statements; um SELECT FOR UPDATE pode esperar e devolver a versão atualizada do alvo. Isso não atualiza automaticamente o snapshot de outras relações consultadas pela policy. O próprio manual de RLS demonstra essa corrida. Portanto, o desenho abaixo cria uma etapa final **posterior** ao lock do alvo; não atribui freshness universal ao lock. [Isolamento PG16](https://www.postgresql.org/docs/16/transaction-iso.html#XACT-READ-COMMITTED), [políticas e corrida com FOR UPDATE](https://www.postgresql.org/docs/16/ddl-rowsecurity.html).

CTEs de DML compartilham snapshot, mas sua ordem de efeitos não é garantida só pela posição no texto. A comunicação de dados alterados deve usar RETURNING. É por isso que o protótipo reúne guarda e UPDATE, sem tentar juntar ingenuamente auditoria antes/depois em CTEs irmãs. [WITH e DML PG16](https://www.postgresql.org/docs/16/queries-with.html#QUERIES-WITH-MODIFYING).

Funções STABLE consultam o snapshot da instrução chamadora; funções VOLATILE podem obter novos snapshots em seus próprios comandos. Não envelopar um mutador VOLATILE no `readMfaRows` nem prometer que uma guarda externa domina SQL executado internamente por qualquer trigger. [Volatilidade PG16](https://www.postgresql.org/docs/16/xfunc-volatility.html).

Essas referências sustentam o modelo; não validam o SQL proposto. Planner, RLS, zero linhas, locks e triggers precisam de ensaio real. A promessa pretendida é guarda MFA vinculada à instrução de escrita, decisões guardadas nos retornos sem escrita e nova decisão MFA após a auditoria. Não há linearização até a resposta de rede, bloqueio universal de identidade ou garantia contra alterações posteriores ao último snapshot. Esperas internas por unique/FK/trigger não são automaticamente o lock de alvo observado pelo teste.

## Fases do comando proposto

### 1. Validação e visibilidade inicial

Manter schemas, validação de UUID, metadados da auditoria e mensagens atuais. UUID malformado continua404 antes da transação; corpo inválido continua400. Não classificar essas validações como consultas de alvo inexistente.

Trocar apenas o SELECT inicial de cada caminho por leitura guardada com `readMfaRows`, projeção explícita e decoder. Pode aproveitar os `*ReadFields`/`*ReadRow` existentes (desde que o DTO permaneça o mesmo) ou usar DTO interno mínimo `{id,buildingId,active}`. A guarda externa produz erro MFA mesmo quando a consulta retorna zero linhas. O filtro `active=true` permanece para `edit`; status permite ativo ou inativo.

Depois da leitura, manter404 para ausência e `assertCapability` para linha visível. Não adquirir FOR UPDATE nessa primeira leitura: aplicar a policy de escrita antecipadamente pode transformar o403 do residente que vê a própria unidade em404.

### 2. Aquisição do lock do alvo

Preservar o FOR UPDATE de status. Para edit, acrescentar lock explícito do mesmo alvo depois da visibilidade/capacidade, antes da instrução final de escrita. Isso torna a espera por esse alvo observável e permite iniciar o statement guardado depois dela. Manter o filtro de registro ativo para edit e não ampliar o escopo do alvo.

Fixar o `buildingId` obtido legitimamente e restringir lock/escrita ao mesmo `{id,buildingId}`. O cliente não pode mover a linha, mas a API não deve presumir que outro escritor privilegiado nunca o faça durante uma espera. Se o alvo não for encontrado depois do lock, executar uma decisão escalar MFA antes do404. Não devolver ao HTTP o conteúdo do SELECT de lock.

O helper de leitura não é o lugar para a aquisição de lock. Manter o lock explícito separado; não relaxar o contrato SELECT estável de `readMfaRows` para caber FOR UPDATE ou DML.

### 3. Retorno sem alteração de status

Quando o alvo travado já tem o estado pedido, não escrever nem auditar. Fazer uma projeção escalar guardada que reúna `app_has_capability(buildingId, manage)` e a view do alvo sob RLS no **mesmo SELECT final**, usando a guarda externa já existente. Exemplo de shape interno: `{allowed:boolean,item:View|null}`. O `buildingId` vem da leitura legítima, não de um parâmetro livre do cliente.

Após a guarda: `allowed=false` significa403; `item=null` significa404; resultado válido devolve a view exata. Isso fecha o caso em que uma capacidade manage expira durante o lock mas o ator continua com read e receberia200 pelo caminho idempotente. Testar separadamente essa diferença de autorização, sem apresentá-la como PMF01/02. Não fazer um assert de manage seguido de outro SELECT solto para a resposta.

### 4. Guarda ligada ao UPDATE e resultado escalar

Executar SQL de comando próprio deste módulo, parametrizado e derivado de três descritores estáticos, sem texto SQL vindo do cliente. Continuar a usar os schemas de PATCH e as policies originais. O comando não é executado por `readMfaRows`.

Shape a validar no PostgreSQL (não é código pronto):

```sql
WITH mfa AS MATERIALIZED (
  SELECT public.app_require_session_mfa() AS allowed
), changed AS (
  UPDATE public.blocks AS target
  SET /* apenas as colunas permitidas pelo schema, com valores parametrizados */
  FROM mfa
  WHERE mfa.allowed
    AND target.id = $id
    AND target.building_id = $building
    /* somente edit: AND target.active */
  RETURNING /* aliases explícitos da view pública */
)
SELECT CASE WHEN mfa.allowed THEN
  COALESCE((SELECT jsonb_agg(to_jsonb(changed)) FROM changed), '[]'::jsonb)
  ELSE NULL END AS rows
FROM mfa;
```

A guarda é dependência do DML e do resultado escalar. Se não houver correspondência, o resultado ainda consome `mfa`: não depender da avaliação de `WHERE guard()` sobre uma tabela vazia. Resultado ausente/null/malformado é falha fechada, nunca sucesso vazio; rows vazio é404 depois da guarda. Deve haver no máximo uma linha da chave primária, decodificada por schema explícito. A view vem de RETURNING, sem reconsultar a tabela após desativar a própria equipe.

O UPDATE continua sujeito a USING/WITH CHECK atuais; uma capacidade local perdida antes desse statement pode eliminar a correspondência ou causar erro, como antes. Não acrescentar privilégio, SD de produto ou mudança de isolation. Não atribuir essa capacidade à guarda MFA, que tem finalidade diferente.

### 5. Auditoria, triggers e decisão de saída

Manter `recordAudit` e a ordem existente: edit depois de changed; status antes de changed. Um UPDATE sem correspondência, recusa MFA ou falha de auditoria deve lançar dentro da mesma transação e reverter os efeitos. Não mesclar os INSERTs de auditoria na CTE do UPDATE: além da ordem e dos snapshots, adicionar RETURNING à auditoria poderia introduzir exigências de SELECT/RLS de audit:read que o ator não tem. A policy de INSERT e a policy de leitura de audit são contratos diferentes.

Depois de concluir escrita **e** auditoria, executar uma última decisão escalar `app_require_session_mfa()` e aceitar somente boolean true, antes de sair da transação. Essa decisão não inclui `assertCapability`, discovery ou nova leitura do alvo. Ela detecta uma obrigação/prova modificada por SQL de trigger ou durante a etapa de auditoria, sem invalidar a autorrevogação legítima da equipe. Uma falha reverte também a escrita/auditoria já efetuadas. Não é substituta da guarda junto ao UPDATE: ambas têm papéis nomeados e testes diferentes.

O trigger de produto localizado em `audit_logs`, `app_audit_capture_scope`036, calcula campos de NEW e não consulta outras relações em seu corpo. A busca estática não encontrou trigger de usuário criado diretamente em blocks/units/teams nas migrations examinadas; isso não equivale a inventário do catálogo em execução. Antes do ensaio, conferir `pg_trigger`, funções e RLS reais, incluindo triggers internos de FK. O teste original já cria um trigger de falha de auditoria; preservá-lo.

Um trigger arbitrário pode alterar novamente estado, suprimir linhas ou produzir efeitos externos; este lote não promete controlar todos esses comportamentos. Não realizar retry automático nem alegar que a CTE congela o SQL interno VOLATILE. Se a decisão final só recebe estado já restaurado por um trigger malicioso, não há prova de todas as transições transitórias ocorridas dentro dele.

## Matriz RED/GREEN dirigida

Os cenários devem agrupar os três tipos de estrutura e os dois comportamentos; as contagens TAP só serão fixadas depois da autoria. Não tratar timeout, setup, falha de limpeza, SQL inválido ou colisão de fixture como RED de segurança. Baseline e fixed recebem o mesmo arquivo de teste.

| Cenário | Barreira real / variação | Baseline esperado a observar | Fixed exigido |
| --- | --- | --- | --- |
| Seis PATCHs com alteração | Após capability real; remover fator ou prova de ator satisfeito, mantendo manage local |200 com DTO esperado e mudança/audit reais, depois restaurados pela fixture |403 PMF01/02; linha, timestamp e auditoria sem alteração |
| Alvo UUID válido ausente | Após contexto/lock compartilhado, antes da primeira busca; promover gestor sem fator ou apagar prova de admin |404 exato, sem alegação de DTO privado |403 PMF01/02 pela leitura guardada |
| Três status sem alteração | Após FOR UPDATE real; remover prova/fator |200/view exata, sem auditoria |403 PMF01/02, sem UPDATE/audit |
| No-op sem manage, mas com read | Revogar apenas grant manage depois da aquisição do lock, mantendo grant read |200 possível; confirmar precondições pelo banco |403 de capacidade, sem adulterar razão MFA |
| Espera real de alvo | Owner segura row lock; observar backend bloqueado; mudar MFA em outra conexão; liberar owner | Para edit e status, resultado exato conforme baseline; nenhuma conclusão baseada só em sleep |Decisão final inicia depois da espera;403 PMF, sem efeito/audit |
| Mudança após auditoria | Interceptar apenas depois do INSERT real; owner remove prova sem alterar manage |Edit pode responder200, DTO/mudança comprovados |Decisão final403 e rollback da escrita/auditoria |
| Trigger de auditoria muda prova | Trigger de fixture estreito, no resourceId/action próprios, limpa o par de prova e retorna NEW |200 se o baseline não observar a mudança; validar que o trigger realmente executou |403 PMF02; rollback também da mudança de prova feita pelo trigger |
| Falha de auditoria | Trigger original levanta exceção |500 e rollback |Mesmo500 e rollback; sem mascarar como MFA |
| Autorrevogação | Gestor autorizado somente pela própria equipe, MFA opcional ou satisfeita |200, uma auditoria, equipe inativa; tentativa seguinte negada |Mesmo contrato, sem assert tardio de manage |
| Controles gerais | Gestor opcional/admin satisfeito; DTOs, inativo, null, estrangeiro, inválido, uniqueness/FK |Contratos originais |Mesmos DTOs e400/403/404/409, sem ampliar escopo |

Não é necessário começar com todas as combinações do produto cartesiano. Primeira rodada discriminante: um edit de unidade, um status de equipe, no-match de UUID e no-op; depois expandir aos seis caminhos para provar que os callbacks corretos foram conectados. Os testes originais continuam obrigatórios na composição final.

### Atores e fixture sem falso RED

- O administrador sujeito à MFA **também precisa de membership/binding BUILDING_ADMIN local**. Adicionar flag administrativa ou binding global apenas para determinar a obrigação MFA. Não esperar que PLATFORM_ADMIN sozinho forneça `units:manage`/`teams:manage`.
- Começar os testes de perda de fator/prova com `/auth/me` satisfeito e uma operação positiva real no mesmo bearer/SID. Preferir cerimônia enroll/confirm real; se algum teste usar owner para arranjar estado, documentar que verifica a fronteira SQL, não a cerimônia. Nunca fabricar autorização no proxy.
- A promoção usa gestor local sem fator e binding global inicialmente inativo; ativar o binding depois da fronteira observada. A negação deve ser de MFA, não falta de manage.
- Para autorrevogação, ator sem membership administrativa paralela: seu único manage deriva da equipe desligada. Separar do ator de promoção para não esconder a perda real de acesso.
- Para testar perda de manage mantendo read, equipe/grants distintos e precondições reais. Não usar residente com unidade invisível e chamar o404 de falha de no-op.
- Dados próprios: uma organização, dois prédios, blocos/unidades/equipes únicos, usuário titular, gestor, leitor e estranho. Uma unidade ligada a bloco estrangeiro deve continuar rejeitada por FK. Conservar strings de timestamp owner para comparação exata; não restaurar precisão microssegundo por Date se a prova exigir igualdade de bytes temporais.

### Triggers e limpeza do ensaio

O trigger que altera prova é **somente fixture descartável**, justificável para observar uma alteração dentro da instrução de auditoria; não é helper do produto e não será chamado por `readMfaRows`. Se precisar SECURITY DEFINER para alterar sessions, fixar search_path, nome UUID, alvo por SID/resourceId/action exclusivos, ownership da fixture, sem grant público, e remover trigger/função em finally. Salvar metadados do catálogo antes/depois. Não usar um trigger genérico ou função que afete outros usuários. O baseline deve provar que o trigger foi exercitado; se ele falhar por ACL ou escopo, corrigir a fixture antes de interpretar RED.

Usar observador delegado com tracking de **todas** as promises reais de transação, como a correção V2 do teste de features. Liberar barreiras e locks owner, abortar HTTP e aguardar transações antes de restaurar observador/limpar. Rejeições SQL esperadas são avaliadas pelo HTTP e não viram uma segunda falha da drenagem. Deadlines e lock_timeout/statement_timeout mantidos; memória/DB sob controle serial do coordenador. Sem reiniciar serviços.

Para lock real, capturar PID da conexão runtime e observar bloqueio no PostgreSQL; não inferir a espera por um atraso. O teste precisa de conexões separadas para holder do lock, alteração de identidade e chamada app, e de um caminho finally que sempre libere o holder. A etapa de owner só prepara/coordena a fixture, não simula uma autorização concedida pelo aplicativo.

## Regressões e critérios de saída

`apps/api/test/tenancy-edit.test.ts` tem11 casos e já cobre views, permissões, conflitos, inativo, auditoria falha, lifecycle de status, autorrevogação, prova SQL e reexecução041. Os atores atuais são gestor local, residente e estranho, sem flag/binding global; não adicionar MFA a eles por conveniência. Preservar também as chamadas diretas `withUserContext` e a comparação de todas as funções/ACL/policies na reexecução041.

Selecionar após inventário: `tenancy-http.test.ts`, `tenancy-people.test.ts`, `building-discovery-resources.test.ts`, `rbac-db.integration.test.ts` e os testes MFA de leituras tenancy já existentes. Essa lista é uma seleção a revisar, não promessa de que todos necessitam adaptação. Não levar automaticamente usuários administrativos HTTP para chamadas SQL diretas sem SID.

Aceite exige: REDs explicados com corpos/efeitos positivos comparados; GREEN com razões específicas e rollback; no-match/no-op provados; lock real observado; autorrevogação legítima e audit preservados; payloads e códigos originais; tipos; regressão na mesma composição; fonte/migrations/grants sem alteração fora do delta; teardown e catálogo restaurados. O protótipo de CTE só vira padrão reutilizável depois dessa prova. Continuam fora deste lote todos os demais comandos, política global em produção e aceites web/nativos.
