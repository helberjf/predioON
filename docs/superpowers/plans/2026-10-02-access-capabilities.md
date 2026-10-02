# Acesso físico por capacidades — 034

Desenho aprovado pelo agente principal em 02/10/2026, com SQL 034 reservado e fonte liberada após a regressão 033. ParkingPanel foi publicado após 18/18 testes em Chromium, Firefox e WebKit no snapshot 033 isolado. A implementação deste recorte usa exclusivamente o banco isolado 5437. Fontes inspecionadas: `apps/api/src/modules/access/routes.ts`, `infrastructure/008-access.sql`, projeção de hardware 020, `packages/shared/src/access.ts`, `services/ingest/src/access/{dispatcher,publish}.ts`.

## Problema concreto e fronteira da entrega

`freshRole`, `accessRole` e `app_access_role` ainda usam membership legado e flag global. A flag permite visualizar/configurar/solicitar abertura; concessões individuais/equipe do catálogo não substituem esse caminho. O dispatcher proprietário ignora RLS e repete a decisão legada. Migrar apenas a aceitação HTTP produziria solicitações que o dispatcher recusaria, ou uma promoção involuntária de direitos se ele mantivesse a flag.

O recorte deve incluir gates, aceitação da intenção, leitura do resultado, validação anterior ao envio, auditoria e consumidores. Deve manter o transporte físico atual: QoS 0, retenção false, fila offline desativada, uma tentativa de publicação, persistência SENT antes de publicar, nenhuma recuperação que reenvie SENT, TTL de 15 segundos, frescor de 60 segundos e correlação completa do ACK. ACK tardio ou repetido não torna um comando expirado novamente executável.

## Modelo de capacidades para revisão

Adicionar recurso `gate`; manter os IDs de comando como entradas pontuais ligadas ao gate real, sem criar agora concessões em comandos futuros. Capacidades propostas:

- `gates:read`: configuração pública do próprio acesso e projeção mínima de saúde. Não concede inventário, histórico alheio nem abertura.
- `gates:manage`: configurar acesso real, sem implícita capacidade de solicitar comando. Criar/retarget exige também gestão/leitura sobre destino real (controlador e gateway coerentes), como estacionamento/regras.
- `commands:request`: capacidade já existente, agora efetivamente consultada tanto pela API quanto pelo dispatcher. Exige `gates:read` sobre o gate real e política `allowResidents` ou gestão explícita do gate; o fato de ser administrador global nunca basta.
- `commands:read-own`: acompanhar somente solicitações do próprio usuário, enquanto há leitura atual do gate/tenant. Separada de `commands:request`, para poder retirar abertura e preservar consulta do resultado já solicitado.
- `commands:read`: histórico operacional do gate autorizado, sem direito de abrir ou configurar. Não inferir esse direito de `gates:manage`.

Defaults conservadores: BUILDING_ADMIN recebe gates read/manage e command request/read-own/read; RESIDENT recebe gates read, command request/read-own. Isso mantém os casos físicos legados autorizados, com `allowResidents` como condição adicional. Papéis globais não recebem capacidades físicas. A inspeção do catálogo SQL 014 e de `ROLE_CAPABILITIES` confirmou que MAINTENANCE_MANAGER/MAINTENANCE não possuem `commands:request` por padrão; 034 não acrescenta essa capacidade nem `gates:read` a esses papéis. Uma concessão explícita pode combinar read e request de vínculos distintos, e a administração deve considerar a união das permissões atuais.

Decisão aprovada pelo agente principal: usar `gates:manage` apenas como dispensa da condição `allowResidents`, sempre exigindo `commands:request` independente. É uma condição baseada em capacidades atuais, sem reintroduzir comparação de papéis. Se o produto exigir abrir acessos restritos sem dar configuração, criar uma capacidade adicional explícita para essa dispensa em outro recorte; não assumir isso por nome de papel. Nenhuma dessas opções permite abertura apenas com read/manage.

## Escopo e projeções

Helpers booleanos devem aceitar apenas capacidades pertinentes, UUID textual seguro, conta/organização/prédio ativos e janelas reais de 021. Gate precisa existir no mesmo prédio; controlador deve ter tipo de portão aceito e apontar exatamente para o gateway desse gate, também no mesmo prédio. Escopos inteiros, gate exato e equipamento/gateway reais podem ser combinados independentemente para read e request; uma concessão em `building` não equivale a inteira. Nunca confiar em IDs enviados no payload para formar pais de um gate existente.

Configuração continua possível para hardware desativado, pois cadastrar/diagnosticar/reativar não equivale a abrir. Atuação exige gate e ambos os hardwares enabled, ONLINE e recentes, limites de futuro/idade preservados. Projetar somente estados necessários ao usuário que já lê o gate. Criação/retarget exige alvos coerentes e autorizados; não requer `devices:read` inteiro e não devolve listas globais para preencher um formulário.

`GET /access` preserva a lista e os campos atuais, mas `available` vem da capacidade de solicitar mais condições operacionais. Um leitor sem request deve ver o motivo de autorização, não um botão habilitado. `latestCommand` precisa ser calculado só a partir de comandos autorizados: o leitor de histórico próprio não pode receber requestId/estado de outro morador. `canManage` legado pode representar apenas concessão inteira; consumidores devem passar a usar ação por gate para concessões exatas. Listas auxiliares de inventário ficam vazias sem capacidade correspondente; seletor não pode bloquear o uso do gate já autorizado.

## RLS e aceitação de intenção

Trocar policies permissivas ALL em gates por SELECT/INSERT/UPDATE e retirar DELETE sem endpoint. Restringir colunas de identidade/tenant/data; configurar target guard e integrity trigger owner-only, sem depender de inventário sob RLS. `GatePatchSchema.partial()` herda defaults de enabled/allowResidents: testar PATCH de nome e retirar defaults do schema de atualização para não desativar/restringir gate acidentalmente.

Gate commands não devem aceitar INSERT arbitrário do runtime. Preferir função controlada de solicitação, como transições de alertas: ator obtido do contexto, parents derivados do gate real, relógio/TTL do banco, estado inicial PENDING, nenhuma coluna de envio/ACK editável. A mesma operação deve serializar requestId por usuário e throttle por gate usando locks atuais, revalidar depois de qualquer espera e registrar intenção/auditoria atomicamente. Se INSERT direto for mantido, será necessário provar que SQL sem WHERE não contorna throttle, duração, identidade ou rate limit; a função controlada torna essa prova mais estreita.

Repetir requestId válido do mesmo ator/gate retorna o registro original, sem novo INSERT e sem reabrir comando terminal. Mesmo requestId em outro gate devolve 409. Revalidar a permissão de solicitação antes do caminho de repetição; consulta independente do resultado permanece possível com read-own. O frontend conserva a intenção em memória diante de resultado incerto e só repete explicitamente o mesmo identificador. Nenhum retry automático de POST ou gesto físico.

Refinamento aprovado: uma nova intenção pode devolver seu recibo ao próprio solicitante sem `commands:read-own`. Repetição que devolve estado de um comando existente exige também leitura atual desse comando, por `commands:read-own` ou `commands:read`; sem isso responde 403 e não insere, audita repetição ou publica. A capacidade de request não deve se tornar um caminho alternativo de consulta após revogar leitura. GET continua independente de request.

Audit branches modificadas somente para `ACCESS_CONFIG_CREATED`, `ACCESS_CONFIG_UPDATED`, `ACCESS_OPEN_REQUESTED`, `ACCESS_REQUEST_REPEATED`; rejeição sem tenant permanece sanitizada e não confirma se um ID oculto existe. Auditoria SYSTEM do dispatcher continua fora do app. Preservar branches anteriores, feature state/event helpers, suporte diagnóstico e ACLs de identity/broker.

## Dispatcher, ordem e limite da revogação

No mesmo checkpoint, o dispatcher deve avaliar as capacidades atuais do `requestedBy` sem confiar em role/flag armazenado. Usar helper owner-only com sujeito explícito, ou contexto de sujeito local na transação proprietária mais os mesmos predicados seguros; nunca disponibilizar ao runtime função que permita escolher outro ator. Validar gate/parents contra os IDs congelados da intenção e política atual, conta/tenant/organização, bindings/equipe, read/request e condição allowResidents. Verificar novamente o relógio depois de locks.

PENDING revogado/expirado/retargeted falha antes de SENT e produz **zero publicações**. Persistir SENT antes da entrega ao MQTT continua sendo a escolha de segurança contra repetição: uma queda entre commit e publish pode perder uma abertura, mas nunca repeti-la. A decisão de autorização precisa de um ponto definido: SENT é entrada em execução; uma revogação posterior não pode prometer desfazer um comando já entregue ao gateway. Testar revogação anterior à decisão, inclusive enquanto a linha do comando está bloqueada. Não alegar atomicidade distribuída entre mudança de RBAC, commit e efeito físico.

Não introduzir lock de gate/device depois de comando se outro fluxo adquirir esses objetos antes do comando. Elaborar a ordem real incluindo pausa de funcionalidades, configuração, throttle, claim SKIP LOCKED e ACK; observar `pg_blocking_pids`, não depender de sleeps arbitrários. O outer feature lock atual permanece até depois de publish e mantém a semântica já testada da pausa. Escopo global de autorização não deve causar varredura de histórico de comandos em leitura de features.

Ordem proposta para solicitação nova: shared feature lock, advisory do ator e do gate, pais device → gateway → gate. Solicitação e checkpoint SENT usam SHARE nos pais para serializar alterações de enabled/status até sua decisão; KEY SHARE isoladamente não impede essas alterações e fica reservado à configuração de relações. Toda espera exige nova leitura dos pais e grants com `clock_timestamp()` após o lock, usando helpers privados `_at`: `statement_timestamp()` dentro de uma chamada não avança durante uma espera. Dispatcher reavalia a capacidade no próprio statement que marca SENT e segura os pais até esse commit. Testar desativação de dispositivo e gateway durante espera, além de revogação e expiração, e verificar ausência de publicação.

## TDD e aceite proposto

1. RED real antes de implementação: pessoa/equipe RBAC sem membership negada; flag global aceita; PATCH de nome redefine defaults; SQL direto consegue tentar contornar fluxo de request quando autorizado apenas por papel legado.
2. Matriz HTTP/RLS: read sem request, manage sem request, request sem read, allowResidents false/true, grants exatos/por controlador/gateway, pais inconsistentes, vizinhos, conta/tenant inativos, papéis/permissões/vínculos/equipes suspensos/expirados. Campos de listagem e histórico respeitam o escopo.
3. Intenções: simultaneidade mesmo requestId gera um registro/audit efetivo; id reutilizado em outro gate dá 409; throttle entre usuários não expõe seus comandos; relógio do banco e TTL de 15 s; idempotência nunca rearma FAILED/EXPIRED/ACKNOWLEDGED/SENT.
4. Dispatcher real com broker de teste: aceitar pela API, revogar cada tipo de autoridade antes de dispatch ou durante lock e verificar zero publishes; desativar allowResidents/tenant/org/hardware/feature e retargetar pais cancela a intenção. Confirmar QoS 0, retain false, ausência de fila/replay/retry, reconnect após criação, queda antes/depois de SENT e falha de publish.
5. ACK correto apenas para SENT vigente e identidade completa; rejeitar ACK de outro gateway/gate/device/tenant, duplicado ou fora de prazo. Remoção do direito após envio não apaga a evidência do resultado físico já em execução; consulta continua obedecendo read/read-own.
6. SQL controlado: coluna imutável/status proibidos, caller não escolhe ator, função de serviço inacessível por app/identity/broker, UUID inválido falha fechado, auditoria forjada negada, rollback sem intenção parcial quando audit falha.
7. Reaplicação dupla preserva grants inativos e recursos anteriores; EXPLAIN de ponto/candidatos sem scan de histórico; catálogo TypeScript/SQL alinhado; limites de query/response e helpers privados auditados.
8. Regressões existentes de access policy/MQTT/idempotência/lifecycle/ingest e novos casos, mais navegador e apps nativos com transporte simulado. Qualificação em controlador físico real é evidência separada e não deve ser inferida de Aedes ou emulador.

Defaults conservadores, histórico independente, condição allowResidents, função controlada e checkpoint do dispatcher foram aprovados. O agente principal encerrou a regressão 033 e liberou o runtime 034; os navegadores permanecem no volume isolado 033.

## RED real anterior à implementação

Quatro testes executados em PostgreSQL/Timescale 5437 contra API/SQL 033, antes de qualquer alteração de runtime deste recorte. As fixtures criam apenas linhas de catálogo temporárias e suas próprias entidades, sem conceder políticas permissivas.

- Pessoa RBAC sem membership recebeu 403 quando leitura deveria ser 200; o mesmo teste incluirá equipe no GREEN.
- Flag global sem concessões recebeu 200 quando a leitura física deveria ser 403.
- PATCH somente de nome respondeu 200, mas alterou enabled para false; os defaults do schema parcial foram confirmados como causa, também materializando allowResidents=false.
- INSERT direto pelo runtime de um comando válido foi aceito, quando a transição controlada deverá ser a única forma de solicitar abertura.

Os quatro testes falharam pelas diferenças de comportamento esperadas, sem falha de fixture, autenticação ou conexão. O arquivo usava sufixo `.pending.ts` durante RED e foi integrado como `access-capabilities.test.ts` no GREEN. Cleanup verificou zero organizações, usuários, papéis e permissões temporárias. Nenhuma publicação MQTT ou atuação física ocorreu no RED.

## Implementação e evidência do checkpoint de backend

034 troca as policies legadas de gates/commands, limita colunas editáveis, preserva hardware desativado para diagnóstico e adiciona escopo gate aos validadores existentes. O runtime perdeu INSERT/UPDATE/DELETE de comandos e só admite intenções pela função controlada. `freshRole`, `accessRole` e `accessAvailability` deixaram o runtime; o helper SQL legado permanece sem EXECUTE para app/identity/broker. API e dispatcher consultam os mesmos predicados atuais, sem promover a flag global ou leitura/configuração a abertura.

Criação de gate usa INSERT com colunas explícitas: o primeiro GREEN encontrou que os defaults gerados pelo ORM também mencionavam colunas de identidade sem autorização. A correção mantém essas colunas proibidas e deixa o banco gerá-las. PATCH de nome preserva enabled/allowResidents. Listas trazem `canManage` por gate, além do campo agregado compatível, e latestCommand é filtrado por RLS antes de selecionar o registro mais recente de cada gate.

O dispatcher mantém o claim existente e o lock de feature através da publicação. A transição privada deriva o ator do comando, bloqueia device/gateway/gate com SHARE, faz auditoria antes da decisão final e avalia relógio/capacidades no próprio UPDATE SENT. Se a decisão após uma espera falhar, remove a auditoria SENT ainda não comprometida e registra FAILED no mesmo fluxo. O contexto anterior do serviço é restaurado. Nada reenvia um comando já SENT; QoS 0, retain false e queueQoSZero false continuam obrigatórios.

Evidência local real em 5437: **71/71** testes API/RBAC/ACL MQTT, incluindo 28 casos novos HTTP/RLS, e **83/83** da suíte completa de ingestão, incluindo 15 novos casos do checkpoint físico. Sem skips ou falhas nas rodadas finais. Typechecks API e ingest passaram. Logs: `work/access-034-api-final.log` e `work/access-034-ingest-final.log` fora do repositório. Outros **46 casos** de alertas, enforcement/lifecycle de funcionalidades e segurança também passaram em `work/access-034-features-regression.log`; essa rodada havia identificado apenas um cast ausente na fixture EXPLAIN, corrigido e aprovado na rodada final de 71 testes.

Os casos novos cobrem grants diretos/equipe/exatos/device/gateway, separação entre request e histórico, revogação de conta/tenant/organização/policy, idempotência simultânea, TTL de 15 segundos, ausência de histórico alheio, SQL direto negado e helpers privados. Esperas reais observadas por `pg_blocking_pids` provaram negação após desativação de dispositivo/gateway, revogação e expiração por passagem do relógio durante auditoria. Auditoria de solicitação que falha deixa zero comandos. Reaplicação dupla dentro de rollback mantém permissões/vínculos revogados e todas as policies de outros domínios.

EXPLAIN sobre 3.000 gates adicionais confirmou acesso pontual por `gates_pkey`; a consulta de escopo usa candidatos de vínculos atuais e não percorre histórico de comandos. A fixture de isolamento de feature de alertas passou a remover temporariamente também `gates:read`, para testar exclusivamente o ramo de alertas sem negar os grants independentes da produção. Cleanup final encontrou zero organizações, usuários, papéis e triggers temporários do recorte.

Os 15 novos testes de dispatch usam PostgreSQL real com um publicador instrumentado para comprovar zero ou uma chamada e opções MQTT; não representam qualificação de controlador físico. Testes existentes de transporte e autorização MQTT continuam passando. O cenário end-to-end com hardware real permanece evidência externa necessária.

O checkpoint de backend não conclui os consumidores: AccessPanel ainda condiciona edição ao agregado `canManage` e à prop do portal, portanto a edição por gate exato será migrada em recorte de UI com Playwright. Mobile já usa `available` da API para abertura, mas sua seleção/descoberta por novas capacidades e confirmações após revogação precisam do próximo recorte. Não ampliar inventário para contornar essa limitação. Os navegadores anteriores permanecem deliberadamente no snapshot 033.
