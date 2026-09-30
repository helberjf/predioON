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
| `GET/POST /v1/tenancy/blocks` | Consultar/criar blocos | `units:read` / `units:manage` |
| `GET/POST /v1/tenancy/units` | Consultar/criar unidades | `units:read` / `units:manage`; RLS limita moradores às próprias unidades |
| `GET/POST /v1/tenancy/teams` | Consultar/criar equipes | `teams:read` / `teams:manage` |
| `GET/POST /v1/tenancy/unit-memberships` | Consultar/criar vínculos com unidades | `memberships:read` / `memberships:manage` |
| `GET/POST /v1/tenancy/team-members` | Consultar/adicionar integrantes | `teams:read` / `teams:manage` |
| `GET/POST /v1/tenancy/role-bindings` | Consultar/conceder papéis do condomínio | `memberships:manage`, limitada às permissões delegáveis que o concedente possui |
| `DELETE /v1/tenancy/{unit-memberships,team-members,role-bindings}/:id` | Revogar vínculo | Mesma capacidade de gestão; a revogação preserva registro e auditoria |

Consultas de listagem recebem `buildingId`, `limit` (1–100, padrão 50) e `after` (UUID retornado como `nextCursor`). Retornam `{ items, nextCursor }`. As alterações usam `buildingId` no corpo e os contratos de `@predioon/contracts/tenancy`. Todas as respostas novas têm `Cache-Control: no-store`.

O vínculo de papel tem uma pessoa **ou** uma equipe, motivo e vigência opcional. Nesta superfície HTTP inicial, os papéis são concedidos ao condomínio inteiro. Não há endpoint público para alterar o catálogo, conceder papéis globais nem produzir credenciais de equipamento. Concessões específicas de recurso no banco exigem sua autorização própria; a criação desses fluxos será integrada aos respectivos domínios.

Blocos, unidades, equipes e seus vínculos são relacionados por chaves compostas que incluem o condomínio. Inserir um vínculo com entidade de outro condomínio falha mesmo se uma consulta da aplicação esquecer o filtro. Respostas de erro não revelam os dados da entidade estrangeira. Alterações bem-sucedidas e sua auditoria são confirmadas na mesma transação.

Adicionar novamente um integrante revogado ou com vigência encerrada renova o mesmo registro, com nova auditoria de vigência. Um vínculo ainda ativo retorna 409; solicitações concorrentes não sobrescrevem a concessão ativa. A revogação da própria concessão administrativa registra a auditoria antes da alteração, na mesma transação, para não depender de uma permissão que acabou de ser retirada.

## Transição e trabalho restante

A migration `016-building-feature-capabilities.sql` migra condomínios e funcionalidades. Manutenção pode selecionar seu escopo sem receber poderes de síndico. Um vínculo limitado a equipamento permite descobrir o cadastro básico do condomínio, mas continua limitado ao recurso nas decisões operacionais. Suporte perde essa descoberta ao expirar ou revogar a concessão, ou ao perder seu papel global. A configuração de funcionalidades preserva controle de versão, locks e cancelamento de comandos pendentes; sua auditoria é transacional.

A migration `017-telemetry-capabilities.sql` separa a leitura técnica da projeção para moradores. Uma concessão diagnóstica de telemetria funciona sem conceder acesso à configuração de equipamentos. A RLS verifica o par condomínio/equipamento e consulta os recursos autorizados por consulta, sem avaliar o RBAC em cada amostra. O administrador global precisa de concessão local explícita para ler telemetria privada.

`telemetry:read-published` pertence aos quatro papéis locais e expõe somente o último nível percentual de água dos sete dias recentes. A resposta mantém o DTO existente, normaliza o número e a unidade e exclui JSON bruto, outras métricas, configuração e histórico. Pausar a funcionalidade oculta a leitura; retomá-la exige nova amostra. A retirada independente de `buildings:read` não pode ocultar as configurações locais e fazer a consulta assumir defaults habilitados.

Os eventos SSE de telemetria usam as mesmas concessões por equipamento. Cada entrega revalida a identidade e consulta as permissões na transação atual, incluindo streams já abertos. Revogar vínculo, equipe ou suporte retira a próxima entrega; revogar a sessão encerra o stream. A publicação para moradores possui oito campos, aceita apenas nível numérico finito entre 0 e 100 e respeita pausa/retomada. Os outros tipos de eventos continuam pendentes de migração.

A etapa 2B ainda está em execução. Equipamentos, gateways, alertas, monitoramento, dashboards, financeiro, acessos e outros cadastros continuam com suas políticas anteriores; ainda não se deve tratar o novo catálogo como autorização completa desses módulos. O painel atual continua usando os três papéis legados enquanto cada módulo migra com testes de API e RLS. A ausência de uma capacidade nova não altera automaticamente as regras antigas.

A API separa as conexões de negócio, identidade e autorização MQTT conforme [credenciais de banco](CREDENCIAIS_BANCO.md). A retirada da credencial proprietária da ingestão ainda está pendente. Também faltam a interface web de gestão destes cadastros, o fluxo de concessão temporária de suporte, MFA para ações privilegiadas, cookies/CSRF e os consumidores móveis. O tracker de execução distingue essas pendências da fundação já verificada.
