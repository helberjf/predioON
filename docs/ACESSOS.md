# Acessos de garagem e pedestres

O módulo cadastra acessos, solicita abertura e acompanha o resultado informado pelo controlador. Uma resposta HTTP 202 significa **solicitação registrada**. Apenas um ACK válido do gateway muda o pedido para `ACKNOWLEDGED`; isso confirma a execução informada pelo controlador, não mede a posição atual do portão.

## Configuração e uso

1. Cadastre o gateway no prédio e provisione suas credenciais MQTT.
2. Cadastre um dispositivo `GATE_CONTROLLER` vinculado a esse gateway.
3. Em **Acessos**, crie uma garagem ou entrada de pedestres, selecionando gateway e controlador. O padrão é desativado, sem permissão a moradores.
4. Após configurar o controlador, habilite a abertura remota. A permissão a moradores é uma opção separada.
5. A abertura exige prédio e usuário ativos, vínculo vigente, gateway e dispositivo habilitados, status `ONLINE` e sinal recebido nos últimos 60 segundos.

Síndicos e administradores configuram acessos. Moradores consultam e solicitam apenas quando autorizados. A API e o RLS consultam usuário e vínculo atuais no banco; o papel antigo em um JWT não concede acesso depois de revogado.

## API

| Método | Caminho | Uso |
|---|---|---|
| GET | `/access?buildingId=...` | Acessos, disponibilidade e último pedido visível; administradores também recebem opções de cadastro |
| POST | `/access` | Cadastrar `buildingId`, `name`, `kind`, `gatewayId`, `deviceId`, `enabled`, `allowResidents` |
| PATCH | `/access/:gateId` | Alterar configuração; prédio não pode ser trocado |
| POST | `/access/:gateId/open` | Solicitar com `{ "requestId": "UUID" }` |
| GET | `/access/commands/:commandId` | Consultar resultado; morador só vê os próprios pedidos |

`kind` aceita `GARAGE` e `PEDESTRIAN`. Repetir o mesmo `requestId` devolve o pedido original sem reenviar. Reutilizá-lo para outro acesso resulta em conflito. Solicitações concorrentes são serializadas por usuário e acesso. Existe intervalo mínimo de cinco segundos por portão, compartilhado por todos os usuários, e outro pedido não é aceito enquanto houver confirmação pendente dentro do prazo.

## Abertura pelo QR do totem (059)

Adicional por condomínio (`GATE_QR_ACCESS`). Um tablet fixado no portão mostra um QR que muda a cada hora cheia; o morador lê o QR **no app do morador**, o app confere no servidor e só então mostra o portão com o botão **Abrir**. O QR não é credencial: a abertura passa pela mesma função de admissão do botão da lista (`app_request_access_admit`), com a mesma sessão, permissões, conferência de equipamento, intervalo de 5 s e espera pela confirmação.

**Quem faz o quê**

| Quem | Onde | O quê |
|---|---|---|
| Administrador da plataforma | admin-web › Funcionalidades › condomínio | Libera o adicional. Sem linha própria do condomínio ele fica **desligado** (`optIn`), ao contrário das outras funcionalidades |
| Síndico (`gates:manage`) | building-web › Portões e acessos | Pareia o tablet, renova o código, despareia e marca **Exigir QR do totem para moradores** |
| Tablet | `https://<building-web>/totem` | Recebe o código de pareamento uma vez e passa a mostrar o QR |
| Morador | app do morador › Acessos › **Ler QR do portão** | Lê, confere e abre |

**Exigir QR.** Marcado, o morador não abre mais pela lista: a admissão recusa com `PQ403` → 403 `QR_REQUIRED` ("Este portão abre pelo QR do totem, no app do morador"). Síndico e administração continuam abrindo pela lista. A exigência só vale enquanto o adicional e a funcionalidade do tipo do portão estiverem ligados; desligado o adicional, a lista volta a valer sem apagar a marcação. A exigência fica só na admissão, não em `app_access_request_permitted_at`, para que a revalidação do dispatcher seja igual nos dois caminhos.

**O código da hora.** O conteúdo é `predioon-portao:v1:<gateId>.<hora>.<mac>`, sem URL, para que a câmera do celular mostre texto em vez de abrir uma página. O `mac` são 16 bytes de HMAC-SHA256 com uma chave por portão derivada (HKDF) de `GATE_QR_SECRET` e da geração do portão. Vale a hora atual e a anterior nos primeiros 5 minutos da hora nova; uma hora futura nunca vale. O HMAC é calculado na API, que guarda a chave, porque o banco não tem `pgcrypto`; o banco guarda só `gates.qr_generation` e a confere sob o bloqueio do portão, então uma renovação não corre contra uma abertura. **Renovar código agora** incrementa a geração e invalida na hora o QR de todos os tablets do portão, inclusive fotos dele.

**Pareamento.** O síndico gera um código de 10 caracteres (50 bits), válido por 10 minutos e de uso único; só o SHA-256 dele é guardado. O tablet troca o código por um token de 32 bytes, também guardado só como hash, que só permite desenhar o QR daquele portão. O pareamento passa pelo mesmo limite de tentativas do login e confere de novo que quem gerou o código ainda gerencia o portão. O tablet não abre sessão de usuário: `/totem` roda fora do `AuthProvider`. Nem token, nem código de pareamento, nem conteúdo do QR vão para a auditoria.

| Método | Caminho | Uso |
|---|---|---|
| POST | `/access/qr/resolve` | `{ content }`: confere o QR e devolve o portão como na lista. QR inválido, de outra hora, renovado ou de portão oculto recebe o mesmo 404 |
| POST | `/access/qr/open` | `{ content, requestId }`: mesma idempotência e respostas 202/200/429 do `/open` |
| POST | `/access/:gateId/qr/renew` | Renova o código. Exige confirmação recente de senha |
| POST | `/access/:gateId/totems/pairing` | Gera o código de pareamento. Exige confirmação recente de senha |
| DELETE | `/access/:gateId/totems/:totemId` | Despareia o tablet; continua possível com o adicional desligado |
| POST | `/totem/pair` | Público: `{ pairingCode, label }` → `{ token }` uma única vez |
| GET | `/totem/display` | Público, `Authorization: Totem <token>`: QR atual, o da próxima hora e a hora do servidor |

Auditoria: `ACCESS_TOTEM_PAIRING_CREATED`, `ACCESS_TOTEM_PAIRED`, `ACCESS_TOTEM_REVOKED`, `ACCESS_QR_RENEWED` e `via: "LIST" | "QR"` em `ACCESS_OPEN_REQUESTED`. Só as funções `SECURITY DEFINER` gravam essas ações.

**Montagem do tablet.** Qualquer tablet ou monitor com navegador, em modo quiosque, ligado na tomada e no Wi-Fi do condomínio, abrindo `/totem` do portal de gestão. A página pede para manter a tela acesa (Wake Lock), troca de QR na virada da hora pelo relógio do servidor e já recebe o QR da hora seguinte, então aguenta oscilação de rede. Se ficar mais de uma hora sem conexão, mostra "Totem sem conexão". O síndico vê o último contato de cada tablet; acima de 3 minutos sem contato aparece em amarelo.

**Limites, sem rodeios**

- Uma foto do QR abre até o fim da hora, mais 5 minutos. A resposta é **Renovar código agora**. A versão forte contra fotos é o NFC com SUN (NTAG 424 DNA), que é outro plano.
- O servidor não consegue provar que a chamada veio do app, e não de um script com a sessão do morador. Isso exigiria atestação (Play Integrity ou App Attest), fora deste módulo.
- A verificação criptográfica do QR fica na API. Uma API comprometida poderia dispensá-la, mas continuaria barrada por sessão, permissões, adicional e equipamento no banco.
- Sem `GATE_QR_SECRET`, em produção, as rotas de QR e do tablet respondem 503 e o resto funciona. Trocar a chave invalida os QR da hora; os tablets mostram o novo em até um minuto.

## Contrato MQTT

Comando: `predio/{buildingId}/gateway/{gatewayId}/access/{gateId}/command`

```json
{
  "commandId": "c3a4615e-0770-4b7c-b0d6-e4343e11cc30",
  "buildingId": "bld_001",
  "gatewayId": "gw_access",
  "gateId": "03d72b85-895c-41df-b3d4-f91ae9ed7822",
  "deviceId": "gate_controller",
  "action": "OPEN",
  "issuedAt": "2026-09-22T12:00:00.000Z",
  "expiresAt": "2026-09-22T12:00:15.000Z"
}
```

ACK: `predio/{buildingId}/gateway/{gatewayId}/access/{gateId}/ack`

```json
{
  "commandId": "c3a4615e-0770-4b7c-b0d6-e4343e11cc30",
  "buildingId": "bld_001",
  "gatewayId": "gw_access",
  "gateId": "03d72b85-895c-41df-b3d4-f91ae9ed7822",
  "deviceId": "gate_controller",
  "result": "EXECUTED"
}
```

O controlador pode responder `REJECTED`. O serviço só aceita ACK cujo comando esteja `SENT`, dentro do prazo e com todos os identificadores correspondentes ao tópico e ao banco. JSON inválido, mensagens grandes, ACK duplicado, estranho ou vencido não confirmam o pedido.

O autorizador HTTP do broker permite ao gateway apenas assinar o tópico exato de comando de seu acesso habilitado e publicar seu ACK. A ingestão assina `predio/+/gateway/+/access/+/ack` e publica apenas comandos de acessos habilitados. Os demais tópicos de telemetria mantêm suas restrições.

## Entrega e integração do controlador

Os comandos usam QoS 0, `retain: false`, validade máxima de 15 segundos e cliente de ingestão com `queueQoSZero: false`. O serviço persiste `SENT` antes de publicar e jamais tenta reenviar esse pedido. Uma queda entre a gravação e a publicação pode perder uma abertura; nesse caso o pedido expira. Pedidos anteriores ao início ou à reconexão do serviço falham em vez de serem reproduzidos. O dispatcher valida novamente vínculo e hardware imediatamente antes do envio.

O firmware do controlador precisa implementar o contrato completo: sessão MQTT limpa (`clean: true`; em MQTT 5 `sessionExpiryInterval: 0`), assinatura exata QoS 0, rejeição de mensagens retidas, relógio sincronizado, verificação de `issuedAt`/`expiresAt`, rejeição de comandos emitidos antes da conexão atual e deduplicação por `commandId`. Não mantenha uma fila local de acionamentos. Use esse comportamento também para evitar armazenamento de mensagens no broker durante uma desconexão. O mapeamento do relé e as condições mecânicas do portão pertencem à integração do hardware; nenhum driver de relé ou acionamento físico foi instalado por este módulo.

Os estados são `PENDING`, `SENT`, `ACKNOWLEDGED`, `FAILED` e `EXPIRED`. Solicitações, repetições, recusas, configuração, envio e resultado geram auditoria. As tabelas de comandos não permitem atualização ou exclusão pela conexão da API.

## Integração do projeto

- Contratos e schema estão exportados pelos pacotes shared e db. Em banco existente, aplicar a migração aditiva `008-access.sql` com `pnpm db:infra`.
- `accessRouter` está montado atrás de `authenticate` em `/access`.
- `AccessPanel` está integrado aos três painéis; a API confirma novamente a permissão de gestão.
- O cliente MQTT de ingestão usa `queueQoSZero: false`, assina `ACCESS_ACK_TOPIC`, encaminha `/ack` para `handleAccessAck` e inicia `startAccessDispatcher(client)`, com encerramento no shutdown.
- Nenhuma variável adicional é necessária para API/ingestão. Permanecem as credenciais `MQTT_AUTH_SECRET`, `MQTT_INGEST_USERNAME`/`MQTT_INGEST_PASSWORD` e `MQTT_USERNAME`/`MQTT_PASSWORD` já usadas pelo broker e pelo serviço.

## Simulação local separada

`services/ingest/src/access/simulator.ts` só aceita broker em localhost. Ele nunca acessa GPIO, Modbus ou relés e não inicia junto do simulador de sensores.

Crie gateway, controlador e acesso específicos para simulação. Habilite esse acesso e forneça os IDs correspondentes:

```powershell
$env:ACCESS_SIM_BUILDING_ID = "bld_001"
$env:ACCESS_SIM_GATEWAY_ID = "gw_access_sim"
$env:ACCESS_SIM_DEVICE_ID = "gate_access_sim"
$env:ACCESS_SIM_GATE_ID = "UUID_DO_ACESSO"
$env:ACCESS_SIM_MQTT_URL = "mqtt://127.0.0.1:1883"
# Se o broker local exigir autenticação, use as credenciais desse gateway.
$env:ACCESS_SIM_MQTT_USERNAME = "gw_gw_access_sim"
$env:ACCESS_SIM_MQTT_PASSWORD = "SENHA_PROVISIONADA"
pnpm --filter @predioon/ingest exec tsx src/access/simulator.ts
```

O simulador publica sinais de presença e responde `EXECUTED` apenas a um comando válido. Use um gateway exclusivo: conectar dois clientes com o mesmo ID derruba a sessão anterior.

## Testes

```powershell
pnpm --filter @predioon/api exec node --import tsx --test test/access-policy.test.ts test/access-qr-code.test.ts
pnpm --filter @predioon/ingest exec node --import tsx --test test/access-dispatch.test.ts test/access-simulator.test.ts
$env:RUN_ACCESS_DB_TESTS = "1"
pnpm --filter @predioon/api exec node --import tsx --test test/access.integration.test.ts test/access-mqtt.integration.test.ts test/access-qr.test.ts
pnpm --filter @predioon/ingest exec node --import tsx --test test/access.integration.test.ts
```

Os testes de integração exigem banco local com schema, infraestrutura e seed aplicados. Usam clientes MQTT falsos em memória; não conectam nem enviam comandos a equipamentos físicos.
