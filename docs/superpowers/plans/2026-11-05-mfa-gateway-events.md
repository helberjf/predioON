# Próximo recorte: gateway-status SSE

**Resultado em 05/11:** sete testes dirigidos e 114 regressões passaram na composição candidata. [Prova e limites](../../evidencias/mfa-gateway-events-2026-11-05.json). O cenário de alvo ausente demonstrou falta de encerramento, com zero frames de dados. O desenho inicial abaixo fica como histórico; demais domínios e integração continuam pendentes.


Proposta estática de 05/11/2026, sem execução/autoria de produto. Fonte: original25 fixed prepared `f2d3055b792c5db6ba5bac5bd699574a064b74d2a3a78b91f1cf1f6d0caeef38`; produto idêntico a7b53. `apps/api/src/modules/events/equipment.ts` SHA34a7275d9fdcaac7ce787e8451c51a43c1c65f26acf4015da077c853e8730d5d; SQL068 SHA7838dcbc01d9bdf741f293e1afe1645dd0daff546760197c991e2b2ddb7f61bb. Fixture25 adaptada SHAadca4cd46d2c9b4e0d2855cc60fcfb28572f67d3d5bffd100d9021a5ae795239. Composição de execução posterior deve incluir heartbeat somente após seu aceite; não transferir provas entre fontes.

## Lacuna concreta de contrato, não vazamento demonstrado

`projectGatewayStatusEvent` faz um SELECT Drizzle direto em gateways, filtrado por par building/id, e reconstrói quatro campos persistidos. Já é INVOKER sob predioon_app: policy020 `gateways_equipment_read` exige app_gateway_has_capability(...,'devices:read'); policy068 restritiva aplica app_require_session_mfa por linha. Portanto gateway NÃO é um projector totalmente sem MFA, e promoção antes de ler uma linha autorizada pode já resultar em PMF01/02.

Falta uma operação guard-first explícita independente de haver linha: SELECT de ID ausente, par divergente ou sem escopo pode retornar zero sem que a expressão da policy seja avaliada. O código então retorna null e mantém a conexão, em vez de garantir a decisão MFA antes de resolver o alvo. Essa é a diferença que o próximo contrato deve fechar. A ordem concreta do planner/RLS precisa ser observada: NÃO prometer que toda consulta ausente reproduzirá ausência do guard, nem chamar resultado vazio de vazamento de dados.

O cenário device já protegido é distinto: contexto/classificação/features e autoridade final exigem duas observações para preservar expiração de suporte. Gateway tem uma única leitura, sem classificação/features nem segunda fase; não copiar essa arquitetura por simetria nem impor freshness de sensor.

## Menor implementação proposta: dois arquivos

1. SQL068 candidata: adicionar `public.app_mfa_gateway_event_context(text,text) RETURNS jsonb`, PL/pgSQL STABLE SECURITY INVOKER, não STRICT, search_path=pg_catalog,public,pg_temp. Primeiro `PERFORM public.app_require_session_mfa()`. Depois SELECT em public.gateways por building/id exatos, conservando RLS existente. Retorno escalar sempre uma linha: `{stored:{buildingId,gatewayId,status}|null}`. Sem gateway encontrado/autorizado =>storednull; argumentosNULL também passam primeiro pelo guard. CamposTEXT continuamTEXT, sem castUUID.
2. equipment.ts: trocar somente projectGatewayStatusEvent por tx.execute do envelope; validar contexto/par e reconstruir os mesmos quatro campos `{kind,buildingId,gatewayId,status}`. Remover imports and/eq/gateways se ficarem sem uso. Não alterar função device, routes, heartbeat, DTOschemas, ingest/broker ou permissões de tabela.

Incluir assinatura na normalizaçãoACL já existente:15→16, owner controlado, remover todos os grantees não-owner via aclexplode, revogarPUBLIC e concederEXECUTE somenteapp. Preservar grants anteriores e sixroles. Não alterar helperSD020 nem ampliar capacidade local/global/support. Nunca introduzir bypassSID para humanos; a uniãoflag010/autoridade021 e055 permanecem como068.

A função STABLE compartilha snapshot guard+leitura. Não garante revogação posterior ao statement/commit ou ao envio na rede. Não acrescentar uma segunda rechecagem gateway sem novo requisito concreto.

## Sete casos dirigidos sugeridos

1. SSE real: a mesma conexão recebe gateway positivo com DTO persistido exato, ignorando status forjado. O segundo evento aponta ID inexistente; uma barreira de teste após resolveIdentity e set_config reais pausa antes do projector. Ativar binding ADMIN preexistente e inativo por owner; confirmar commit e liberar. Exigir fechamento sem novo frame. Sinalizar settlement da transação e observar res.end/close, sem confundir ausência de fechamento com timeout de fixture. Não usar features marker, já protegido. Se baseline já fechar por RLS, registrar controle PASS, sem fabricar RED. Qualquer frame deve ser decodificado antes da assertiva.
2. PMF01: administrador sem fator, com alvo existente/ausente/foreign/par errado/NULL, deve falhar igualmente. Wrapper ausente na baseline (42883) é falha de contrato, não vazamento.
3. PMF02: fator sem prova e SID ausente/inválido/de outra família, incluindo alvos NULL. Prova sintética via owner não equivale a cerimônia TOTP.
4. Optional e satisfied: três campos exatos em stored, quatro no projector; metadata/serial/segredos/status forjado excluídos. MFA satisfeita não concede capacidade. Escopos device-only e gateway-only independentes.
5. Ausente/foreign/par errado/TEXT estranho opcionais: storednull/projectornull, conexão ainda utilizável, envelope escalar sempre uma linha. IDs continuam parâmetros SQL.
6. Inventário desabilitado e status atual continuam visíveis. Pausar features ou avançar resumedAt não oculta gateway. Suporte exato de gateway expirado/revogado não entrega; arranjo created_at deve respeitar CHECK expires>created, sem sleep.
7. Catálogo/ACL16: guard-first, não STRICT, STABLE/INVOKER, search_path/owner e EXECUTE app-only nas seis roles reais, sem grants novos de tabelas.

Agrupar subcasos mantendo sete casos manejáveis. A primeira comparação deve caracterizar a baseline honestamente: ausência de fechamento pode ser falha de contrato/liveness, nunca exposição privada por si só. Não deixar 42883 cancelar o caso SSE. Se nenhum controle comportamental falhar na baseline, apresentar endurecimento de contrato, não uma vulnerabilidade inventada.

## Originais e regressões

Preservar equipamento25 adaptado inteiro, assertions, prazos e auto_explain. Casos relevantes: 3 grants diretos/team/legado; 4 escopo device/gateway e DTO forjado; 5 negação de resident/global/outsider; 6 inventário desabilitado/status alterado; 7 IDs TEXT/foreign/inconsistentes; 8 suporte e revogação; 11 membership/team; 12 janelas de suporte; 16 features pausadas com gateway visível; 17 role/permission inativos; 21 suporte telemetry/alerts não concede equipment; 23 sessão revogada/conta inativa.

Caso22 reavalia suporte entre features e autoridade do DEVICE: preservar inalterado, sem apresentá-lo como duas consultas gateway. Caso25 usa auto_explain com arranjo owner e SET ROLE app: preservar artefato e esse limite.

Root deverá fixar nova composição, resolver/types do novo arquivo+imports e executar comparador/fixed serialmente em UUID oficial068, mantendo guards existentes. Regressões: heartbeat novo, device9, originais25 e sete arquivos71. Reserva8 é regressão adjacente de agenda, não prova heartbeat/gateway.

Nenhuma migration aplicada à main nesta etapa. Continuam pendentes HTTP/mutações/outros domínios, integração web/nativa, backpressure e aceite operacional. Este plano não autoriza execução por si só.
