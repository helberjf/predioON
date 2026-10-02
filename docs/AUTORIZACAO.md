# Autorização por condomínio e recurso

A migração `014-rbac-tenancy.sql` introduz o catálogo de capacidades, concessões por pessoa ou equipe, unidades e vínculos com vigência. `building_id` continua sendo o identificador do tenant. A organização comercial não concede acesso operacional.

## Superfície nova da API

Todas estas rotas exigem a sessão central. Usam a conexão `predioon_app`, autorização consultada no banco dentro da transação e RLS. Não usam o nome do aplicativo nem a ordenação de papéis para autorizar.

| Rota | Uso | Capacidade |
| --- | --- | --- |
| `GET /v1/authorization?buildingId=…` | Capacidades atuais no condomínio; tipo e ID de recurso são opcionais e devem vir juntos | Retorna somente concessões vigentes; escopo sem permissões recebe 403 |
| `GET /v1/buildings` e `GET /v1/buildings/:id` | Seleção e cadastro básico dos condomínios autorizados | Descoberta por vínculo vigente, equipe, recurso ou concessão diagnóstica; diretório global exige `buildings:read` |
| `POST /v1/buildings` | Provisionar condomínio | `buildings:provision` global |
| `PATCH /v1/buildings/:id` | Editar ou reativar cadastro | `buildings:manage` no condomínio ou global |
| `GET /v1/features/buildings/:buildingId` | Consultar estado das funcionalidades | Descoberta do condomínio; não concede acesso aos dados do domínio |
| `GET /v1/features/catalog`, `GET /v1/features/global` e alterações de funcionalidades | Catálogo, padrões e configuração | `features:manage` global |
| `GET /v1/telemetry/latest?buildingId=…` | Últimas leituras no escopo atual | `telemetry:read` por equipamento ou projeção limitada por `telemetry:read-published` |
| `GET /v1/telemetry/series?deviceId=…` | Histórico técnico agregado | `telemetry:read` no equipamento; recurso inacessível/ausente recebe 404 |
| `GET /v1/alerts` | Listar alertas no escopo atual, com filtro de condomínio/status e paginação por offset | `alerts:read` no alerta, dispositivo/gateway explicitamente relacionado ou condomínio inteiro |
| `POST /v1/alerts/:alertId/acknowledge` | Reconhecer alerta | `alerts:read` e `alerts:acknowledge`; sem acesso ao alerta recebe 404 |
| `POST /v1/alerts/:alertId/resolve` | Resolver alerta | `alerts:read` e `alerts:resolve`; padrão do síndico e responsável pela manutenção |
| `GET /v1/devices` e `GET /v1/devices/:deviceId/metrics` | Inventário e métricas configuradas | `devices:read` no dispositivo; métricas usam o condomínio do dispositivo real |
| `GET /v1/gateways` | Inventário de gateways | `devices:read` no gateway; sem username/hash MQTT |
| `POST /v1/devices` e `POST /v1/gateways` | Cadastrar equipamento | `devices:read` e `devices:configure` inteiras no condomínio |
| `PATCH /v1/devices/:deviceId`, `PATCH /v1/gateways/:gatewayId` e `POST /v1/devices/:deviceId/metrics` | Configurar recurso existente | Leitura e configuração no recurso; ausente/inacessível recebe 404, visível sem ação recebe 403 |
| `POST /v1/gateways/:gatewayId/credentials` | Emitir/rotacionar credencial MQTT | Leitura e configuração no gateway; senha retornada uma vez, somente hash armazenado |
| `GET/POST /v1/tenancy/blocks` | Consultar/criar blocos | `units:read` / `units:manage` |
| `GET/POST /v1/tenancy/units` | Consultar/criar unidades | `units:read` / `units:manage`; RLS limita moradores às próprias unidades |
| `GET/POST /v1/tenancy/teams` | Consultar/criar equipes | `teams:read` / `teams:manage` |
| `GET/POST /v1/tenancy/unit-memberships` | Consultar/criar vínculos com unidades | `memberships:read` / `memberships:manage` |
| `GET/POST /v1/tenancy/team-members` | Consultar/adicionar integrantes | `teams:read` / `teams:manage` |
| `GET/POST /v1/tenancy/role-bindings` | Consultar/conceder papéis do condomínio | `memberships:manage`, limitada às permissões delegáveis que o concedente possui |
| `DELETE /v1/tenancy/{unit-memberships,team-members,role-bindings}/:id` | Revogar vínculo | Mesma capacidade de gestão; a revogação preserva registro e auditoria |

Consultas de listagem recebem `buildingId`, `limit` (1–100, padrão 50) e `after` (UUID retornado como `nextCursor`). Retornam `{ items, nextCursor }`. As alterações usam `buildingId` no corpo e os contratos de `@predioon/contracts/tenancy`. Todas as respostas novas têm `Cache-Control: no-store`.

O vínculo de papel tem uma pessoa **ou** uma equipe, motivo e vigência opcional. Nesta superfície HTTP inicial de tenancy, os papéis são concedidos ao condomínio inteiro. Não há endpoint público para alterar o catálogo ou conceder papéis globais. Concessões específicas de recurso no banco exigem sua autorização própria; a criação desses fluxos será integrada aos respectivos domínios. A emissão de credenciais de equipamento usa o endpoint autorizado do gateway.

Blocos, unidades, equipes e seus vínculos são relacionados por chaves compostas que incluem o condomínio. Inserir um vínculo com entidade de outro condomínio falha mesmo se uma consulta da aplicação esquecer o filtro. Respostas de erro não revelam os dados da entidade estrangeira. Alterações bem-sucedidas e sua auditoria são confirmadas na mesma transação.

Adicionar novamente um integrante revogado ou com vigência encerrada renova o mesmo registro, com nova auditoria de vigência. Um vínculo ainda ativo retorna 409; solicitações concorrentes não sobrescrevem a concessão ativa. A revogação da própria concessão administrativa registra a auditoria antes da alteração, na mesma transação, para não depender de uma permissão que acabou de ser retirada.

## Transição e trabalho restante

A migration `016-building-feature-capabilities.sql` migra condomínios e funcionalidades. Manutenção pode selecionar seu escopo sem receber poderes de síndico. Um vínculo limitado a equipamento permite descobrir o cadastro básico do condomínio, mas continua limitado ao recurso nas decisões operacionais. Suporte perde essa descoberta ao expirar ou revogar a concessão, ou ao perder seu papel global. A configuração de funcionalidades preserva controle de versão, locks e cancelamento de comandos pendentes; sua auditoria é transacional.

A migration `019-building-discovery-resource-validation.sql` corrige a descoberta limitada a recurso: dispositivo, gateway e outras entidades precisam existir no condomínio declarado. IDs ausentes, estrangeiros, inválidos ou sem mapeamento concreto não permitem ler cadastro/estado básico. A validação interna é executável somente pelo proprietário administrativo, sem expor uma consulta de existência às credenciais de runtime. Concessões inteiras e o diretório global explícito permanecem válidos; retirar `buildings:read` não retira a leitura de estado de funcionalidades ainda autorizada pelos domínios de telemetria/alertas. As duas revisões foram aprovadas e a regressão API passou em 266/266, sem skips/cancelamentos.

A migration `017-telemetry-capabilities.sql` separa a leitura técnica da projeção para moradores. Uma concessão diagnóstica de telemetria funciona sem conceder acesso à configuração de equipamentos. A RLS verifica o par condomínio/equipamento e consulta os recursos autorizados por consulta, sem avaliar o RBAC em cada amostra. O administrador global precisa de concessão local explícita para ler telemetria privada.

`telemetry:read-published` pertence aos quatro papéis locais e expõe somente o último nível percentual de água dos sete dias recentes. A resposta mantém o DTO existente, normaliza o número e a unidade e exclui JSON bruto, outras métricas, configuração e histórico. Pausar a funcionalidade oculta a leitura; retomá-la exige nova amostra. A retirada independente de `buildings:read` não pode ocultar as configurações locais e fazer a consulta assumir defaults habilitados.

Os eventos SSE de telemetria usam as mesmas concessões por equipamento. Cada entrega revalida a identidade e consulta as permissões na transação atual, incluindo streams já abertos. Revogar vínculo, equipe ou suporte retira a próxima entrega; revogar a sessão encerra o stream. A publicação para moradores possui oito campos, aceita apenas nível numérico finito entre 0 e 100 e respeita pausa/retomada. As regras dos demais kinds atuais estão descritas nos recortes seguintes.

A migration `018-alert-capabilities.sql` e os handlers HTTP de alertas estão concluídos, com revisões de conformidade e qualidade aprovadas. A regressão integral conjunta com SSE passou em 248/248. A equipe de manutenção reconhece alertas; somente os papéis locais de síndico e responsável pela manutenção recebem `alerts:resolve` por padrão. Suporte apenas lê os recursos expressamente concedidos; administração global precisa de concessão local para conteúdo privado. Todos os relacionamentos de alerta/regra/dispositivo/gateway precisam pertencer ao condomínio declarado.

O processo HTTP não pode inserir, atualizar ou excluir diretamente alertas. A função de transição valida leitura e ação, bloqueia a linha, revalida após a espera e registra ator/data do banco junto da auditoria. Repetir o mesmo estado conserva os dados anteriores e não duplica auditoria; tentar reconhecer um alerta resolvido retorna 409. Configurações de pausa são consultadas sob lock, inclusive sem `buildings:read`; a leitura de um alerta específico e seu estado de funcionalidades não percorrem o histórico. A listagem preserva paginação por offset e filtros de funcionalidades da interface existente.

Os eventos SSE de alertas foram migrados e aprovados nas duas revisões. Cada entrega consulta a concessão atual e o alerta persistido; os nove campos do envelope entregue vêm do banco, incluindo estado e referências. IDs inválidos ou fora do escopo são ignorados sem encerrar a conexão. Pausa e retomada usam o horário persistido do alerta: o histórico HTTP permanece disponível, mas alertas anteriores à retomada não reaparecem como novos eventos. As 17 novas provas incluem revogação no stream aberto e campos falsificados no NOTIFY.

A migration `020-equipment-capabilities.sql` migra inventário, configuração e credenciais HTTP de dispositivos/gateways. Manutenção lê; síndico configura; suporte apenas lê o recurso concedido. Concessão em dispositivo não se propaga ao gateway nem vice-versa. Relações dispositivo/gateway e métrica/dispositivo precisam pertencer ao mesmo condomínio. Recursos desativados continuam disponíveis para diagnóstico/configuração; pausa de uma funcionalidade não concede nem retira configuração.

Alterações existentes autorizam antes do row lock e consultam novamente leitura/configuração após a espera. Alteração, emissão e criação de métrica confirmam junto da auditoria. O processo HTTP só atualiza colunas de configuração, sem escrever status/last_seen ou excluir equipamentos/métricas. A senha MQTT não aparece em inventário, edição, auditoria ou logs; PATCH preserva as credenciais existentes e rejeita alteração de suas chaves. Rotacionar invalida a senha anterior; os privilégios do broker permanecem separados.

A disponibilidade e solicitação de abertura de um portão existente usam uma projeção limitada ao seu hardware real: habilitado, status e last_seen do gateway/dispositivo. Essa consulta verifica tenant, referências e acesso físico atual sem conceder inventário privado ao morador. A policy de inserção do comando usa a mesma projeção e conserva ator, estado inicial, tempo, referências, permissão residencial e hardware recente; TTL, dispatcher e proibição de replay permanecem iguais. As regras físicas legadas ainda aguardam sua própria migração por capacidade.

A migration `021-authorization-time-windows.sql` corrige a vigência durante transações longas: as consultas de autorização usam `statement_timestamp()`, inclusive vínculos individuais, equipes, memberships, suporte temporário e papéis globais. Uma consulta já admitida pode terminar no seu snapshot; a consulta seguinte recebe um novo instante. O cliente não pode escolher esse relógio nem executar os helpers internos com um horário histórico.

As transições privilegiadas de alertas e funcionalidades capturam um único instante do banco após obter o bloqueio e revalidam leitura/ação ou capacidade global com esse instante. Os handlers de configuração de equipamentos reconsultam RLS e capacidade em novos statements após o bloqueio. Expirar durante a espera impede alteração e auditoria; os efeitos de pausa, controle de versão e cancelamento sem replay permanecem preservados. Os módulos físicos ainda legados precisam aplicar o mesmo padrão na sua migração e antes do despacho.

A policy de telemetria em 021 calcula uma vez por consulta o mapa dos pares condomínio/dispositivo autorizados, inclusive quando as amostras atravessam vários chunks do Timescale. As chaves serializam o par ordenado, sem concatenar IDs com delimitadores. O mapa ocupa memória proporcional aos equipamentos autorizados e não consulta o histórico para decidir permissão.

O recorte 021 passou nas revisões de conformidade e qualidade e na API integral em 316/316 testes, 33 suites, sem skips/cancelamentos. A comparação de catálogo preservou assinaturas, grants e demais policies; a fixture de telemetria prova um helper/um loop em dois chunks. Os testes de espera também limitam aquisição, propagam falhas e confirmam liberação de locks.

A migration `022-equipment-events-capabilities.sql` conclui a autorização dos cinco kinds atuais do SSE central. Status de dispositivo e gateway exige leitura do recurso real e entrega exatamente quatro campos com estado persistido, descartando campos/status recebidos no NOTIFY. A concessão de dispositivo não libera seu gateway. O dispositivo é classificado por projeção mínima, respeita as funcionalidades locais e revalida a capacidade após consultá-las; expiração entre consultas impede entregar o status em memória. A pausa não oculta status do gateway nem cria um requisito artificial de frescor para o status retomado do dispositivo.

O marcador de funcionalidades contém somente kind/buildingId. O global, com '*', invalida o estado de qualquer sessão válida; o local exige condomínio real e direito atual de descoberta/estado operacional ou gestão global de funcionalidades. Ele não concede leitura de conteúdo técnico. Leitores somente de equipamento conseguem consultar as pausas e retomadas sem depender de buildings:read, telemetria ou alertas. Um kind futuro desconhecido não cai em entrega permissiva.

O recorte 022 passou nas duas revisões e na API integral final em 339/339 testes, 34 suites, sem skips/cancelamentos. Os 23 novos testes incluem SSE/NOTIFY reais, permissões restritas, pausa de água/portão/estacionamento, combinação de funcionalidades e expiração entre consultas. A comparação final preserva catálogo, timestamps, grants, assinaturas e todas as policies existentes; acrescenta somente duas policies SELECT de estado de funcionalidades. Fixtures/transações/locks ficaram zerados.

A migration `023-monitoring-capabilities.sql` migra perfis, consumo, estimativas de custo e análise técnica para `telemetry:read` no dispositivo real. Suporte com leitura técnica específica consulta somente os perfis concedidos, sem precisar receber inventário/configuração bruta. Publicação percentual de água, descoberta básica, concessão em gateway ou administração global não liberam esses derivados privados. Custos estimados não concedem acesso a lançamentos ou relatórios financeiros.

Configurar exige simultaneamente leitura técnica, `devices:read` e `devices:configure` no mesmo dispositivo. O app não troca identidade/tenant/dispositivo/kind do perfil, exclui perfis ou escreve agregações. PATCH autoriza antes de bloquear e revalida após a espera; criação usa ID do servidor e leitura em statement seguinte ao INSERT. Perfil e auditoria confirmam juntos. Pausas são consultadas independentemente do cadastro básico e a configuração adaptativa armazenada permanece preservada ao editar outro campo com AI pausada.

GET revalida o escopo e cada perfil depois das consultas de histórico, removendo conteúdo em memória cujo direito expirou ou foi revogado. A projeção mínima conserva os cálculos e a ordenação PostgreSQL anterior, inclusive tipos de medidor e nomes acentuados. Totais/cursors verificam um mapa dos pares condomínio/perfil autorizado uma vez por statement, sem decidir permissão pelo histórico.

O recorte 023 passou nas duas revisões, no dirigido 165/165 e na API integral do agente principal em 365/365 testes, 35 suites, sem skips/cancelamentos. São 26 novos testes reais de HTTP/RLS, vigência, espera, pausa e rollback. Comparação final preserva catálogo com timestamps precisos, helpers/grants/policies alheios e demais branches de auditoria; fixtures/transações/locks zerados.

A migration `024-overview-capabilities.sql` separa o resumo agregado da plataforma do conteúdo privado dos condomínios. `platform:read-health` exige autorização global vigente e permite somente contagens e distribuição de status. A lista identificada exige também `buildings:read` global; sem ela, o diretório fica indisponível e os totais permanecem autorizados. Não há concessão global de inventário, mensagens de alertas ou telemetria privada.

O dashboard local distingue cobertura inteira, parcial e ausente para equipamentos, gateways, alertas e telemetria. Contadores sem leitura são null; zero representa um conjunto autorizado realmente vazio. Recursos e escopo são revalidados antes de entregar o resumo em memória. Alertas recentes respeitam as funcionalidades antes do limite; o inventário diagnóstico independe de pausa. O contador de chamados foi integrado pela migration 031, descrita abaixo.

Os painéis apresentam estados parciais e indisponíveis sem convertê-los em ausência de problemas. A indicação positiva exige inventário completo, observações recentes válidas, cobertura técnica inteira e funcionalidades de monitoramento vigentes. Consumo pausado impede a indicação positiva mesmo quando o mesmo medidor ainda fornece tensão recente. O resumo global usa a projeção agregada, sem buscar inventário ou alertas privados como substitutos.

O recorte 024 passou nas duas revisões, no dirigido 184/184, na UI 41/41 e na API integral do agente principal em 384/384 testes, 36 suites, sem skips/cancelamentos. Seis verificações de tipos, fronteiras e builds dos dois painéis passaram; seis cenários foram verificados no navegador local. Catálogo anterior, assinaturas, owners, ACLs, policies e grants preservados, com somente a capacidade global, seu vínculo e dois helpers novos; fixtures/transações/locks zerados.

## Comunicação, rotina e contas — 026 a 031

As rotas seguintes usam a sessão atual, a credencial restrita da API e o condomínio/recurso persistido. A capacidade de descobrir o cadastro básico de um prédio continua independente da autorização de seu conteúdo. Uma aplicação que precisa listar o prédio também necessita de `buildings:read`, que pode estar limitada ao mesmo recurso real; uma capacidade de domínio isolada não acrescenta automaticamente esse cadastro à seleção do aplicativo.

| Domínio | Leitura | Alteração |
| --- | --- | --- |
| Avisos (`/notices`) | `notices:read`, respeitando publicação, audiência e escopo | `notices:manage` com leitura; calendário e publicação mantêm as regras do domínio |
| Chamados (`/occurrences`) | `occurrences:read-own` para o autor, ou `occurrences:manage` no chamado real | Criação própria exige `occurrences:create-own` e leitura própria; gestão exige capacidade específica; autor tem operações estreitas de comentário/cancelamento |
| Áreas (`/common-areas`) | `common-areas:read` | `common-areas:manage` e leitura; criação exige concessão inteira |
| Reservas (`/reservations`) | `reservations:read-own` para o solicitante, ou gestão autorizada | `reservations:create-own`, `reservations:cancel-own` e `reservations:manage` são independentes; criação depende também de leitura da área |
| Ocupação (`/reservations/availability`) | `reservations:read-calendar` e leitura da área | Consulta somente; devolve apenas início e fim de intervalos ocupados |
| Contas (`/finance`) | `finance:read-published` para relatórios publicados, ou `finance:read` para leitura administrativa | `finance:manage` e leitura administrativa; criar revisão exige ambas inteiras no condomínio |

Em 027, agrupar chamados ou atribuir um responsável não torna seus relatos públicos. Um solicitante não recebe eventos privados de um vizinho do mesmo grupo. Gestão exata de um chamado não autoriza alterar outros integrantes escondidos do grupo. Eventos preservam autor/condomínio/identidade, e o processo HTTP não pode reescrever ou excluir o histórico. Cancelamento próprio usa função restrita, bloqueia a linha e verifica novamente a autorização com o relógio atual do banco.

Em 028/029, a autorização de reservas deixou de depender de permissões de chamados. Reservas e decisões preservam identidade do solicitante, área e intervalo; estados terminais não podem ser reabertos por alterações genéricas. Aprovação/cancelamento revalidam após espera por bloqueio, e a auditoria participa da transação. Disputa pelo mesmo horário continua resolvida pelo banco. Consultar ocupação não revela ID da reserva, pessoa, unidade, notas ou motivo de decisão. A janela deve ter instantes explícitos e durar no máximo 31 dias. O calendário web informa atualmente o fuso do navegador; adoção consistente do fuso configurado no condomínio permanece uma melhoria separada.

Em 030, `finance:manage` isolada não permite ler ou publicar. Os quatro papéis locais recebem leitura publicada por padrão; somente BUILDING_ADMIN recebe gestão. Pessoas/equipes e concessões exatas funcionam sem membership legado. O administrador global e suporte técnico não herdam contas privadas. `finance:read-published` não revela rascunhos nem publicações futuras, e a resposta é revalidada antes da entrega de dados já carregados.

Conteúdo publicado é imutável: correções criam outra revisão. O processo HTTP não altera identidade, condomínio, mês, revisão ou campos de criação; DELETE é negado. Edição/publicação obtêm bloqueios em ordem consistente, verificam novamente leitura/gestão e mantêm controle de versão. Uma concessão exata não pode publicar uma revisão antiga escondendo uma publicação mais nova: uma função proprietária autorizada devolve somente o booleano necessário, e a política SQL também exige essa condição. Valores continuam em centavos e comprovantes seguem a validação HTTPS existente; não há processamento bancário nesse módulo.

Em 031, `/overview/building` acrescenta `occurrenceVisibility` e mantém `counts.open_occurrences` nullable. Gestão inteira resulta em `whole/all`; leitura própria em `partial/own`; gestão específica, inclusive combinada com leitura própria, em `partial/scoped`. Apenas OPEN, IN_ANALYSIS e IN_PROGRESS entram no contador. Ausência de capacidade ou TICKETS pausada produz `none/none` e null. A contagem e sua autorização são consultadas juntas no statement final; não incluem identidade, protocolo, descrição ou eventos. Os rótulos do painel distinguem claramente essas visões e não inferem saúde completa do condomínio a partir delas.

Os recortes 030/031 passaram na regressão integral de 501 testes da API e na matriz Playwright de 63 combinações. A interface financeira agora consulta a permissão do relatório selecionado: leitura e gestão são exigidas juntas para editar/publicar, enquanto criação e nova revisão exigem escopo inteiro. A lista autorizada não depende de `buildings:manage`. Doze combinações dirigidas nos três navegadores verificaram finanças e overview após essa integração. As provas e os commits são registrados no [tracker](superpowers/plans/2026-09-27-product-execution.md).

## Configuração das regras de alerta — 032

`alert-rules:read` e `alert-rules:manage` são independentes de alertas, telemetria e inventário. Somente BUILDING_ADMIN recebe ambas por padrão. A leitura/gestão pode ser concedida no condomínio inteiro, na regra concreta ou em seu dispositivo real; uma regra geral sem dispositivo exige concessão inteira para criação. Suporte técnico e administração global não ganham configuração privada implicitamente.

Mudar o dispositivo exige autorização sobre a regra atual e o destino; remover o dispositivo para tornar a regra geral exige concessão inteira. A mesma restrição vale para SQL direto. Equipamentos desabilitados continuam configuráveis. A API consulta somente a classificação mínima necessária para verificar funcionalidades, sem liberar inventário ao leitor da regra.

PATCH preserva todos os campos omitidos, incluindo gravidade e cooldown. Antes de retarget, o dispositivo de destino é bloqueado com KEY SHARE autorizado; a regra é bloqueada em seguida, na ordem compatível com ingestão. Há revalidação depois das esperas. DELETE mantém auditoria e remoção na mesma transação e conserva alertas históricos. O deadlock com a ingestão foi reproduzido antes da correção; não foram acrescentadas retentativas de mutação.

O recorte passou em 222 testes dirigidos antes do ajuste final de locks, seguido de 36 testes e duas novas corridas de revogação no lock de destino. Revisões independentes não encontraram bloqueadores. A regressão integral com 032 e as novas sessões web está em execução; a interface de regras ainda está sendo alinhada a esses escopos.

## Sessões web — backend disponível, migração dos portais em andamento

As rotas `/auth/web/login`, `/auth/web/refresh` e `/auth/web/logout` guardam o refresh somente em cookie HttpOnly. Em HTTPS o cookie tem Secure e prefixo `__Host-`, sem Domain, com SameSite=Strict e nome distinto por origem permitida. Cada requisição exige Origin exata, JSON e `X-Predioon-Web: 1`; requisições cross-site são rejeitadas. Os portais e a API devem compartilhar o mesmo site HTTPS em produção. HTTP é admitido apenas para origens loopback fora de produção.

O JSON contém access token e identidade; a validade do cookie acompanha a expiração absoluta da família. Replay/expiração apagam o cookie, enquanto erro transitório preserva possibilidade de recuperação. Rotas de domínio continuam exigindo bearer. Dez testes novos e 23 dirigidos com JWT/ciclo de sessões passaram, incluindo rollback real de rotação. Os endpoints nativos permanecem compatíveis. A substituição de localStorage nos portais e a coordenação entre abas ainda precisam concluir a validação do cliente, conforme [plano de sessões web](superpowers/plans/2026-10-02-web-cookie-sessions.md).

## Fronteiras ainda em migração

A etapa 2B permanece aberta. Estacionamento, atuação física e parte da administração ainda precisam concluir a migração própria. Kinds novos de eventos precisam de projeção e autorização específicas. Consumidores web/mobile estão sendo alinhados às capacidades de cada domínio; telas ainda legadas não devem usar a ausência de uma capacidade nova para presumir que suas regras anteriores foram migradas.

A API separa as conexões de negócio, identidade e autorização MQTT conforme [credenciais de banco](CREDENCIAIS_BANCO.md). A retirada da credencial proprietária da ingestão ainda está pendente, junto do processamento durável. Também permanecem fluxos de suporte, MFA para ações privilegiadas, cookies/CSRF, conclusão dos cadastros e homologação dos consumidores móveis. O tracker distingue essas pendências da fundação já verificada.
