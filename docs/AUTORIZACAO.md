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

A etapa 2B ainda está em execução. Monitoramento, dashboards, financeiro, acessos e outros cadastros continuam com suas políticas anteriores; ainda não se deve tratar o novo catálogo como autorização completa desses módulos. Kinds novos de eventos precisam de projeção e autorização próprias. O painel atual continua usando os três papéis legados enquanto cada módulo migra com testes de API e RLS. A ausência de uma capacidade nova não altera automaticamente as regras antigas.

A API separa as conexões de negócio, identidade e autorização MQTT conforme [credenciais de banco](CREDENCIAIS_BANCO.md). A retirada da credencial proprietária da ingestão ainda está pendente. Também faltam a interface web de gestão destes cadastros, o fluxo de concessão temporária de suporte, MFA para ações privilegiadas, cookies/CSRF e os consumidores móveis. O tracker de execução distingue essas pendências da fundação já verificada.
