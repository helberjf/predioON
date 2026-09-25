# Instalação — Prédio ON

O roteiro completo, com resumo inicial, instalação de campo, primeira conta administrativa, operação e aceite, está no [manual de implantação em condomínio](IMPLANTACAO_CONDOMINIO.md). Este arquivo detalha a infraestrutura.

Configuração preparada para uma VPS com Docker Compose. A entrega de 21/09/2026 foi
validada localmente; não foi publicada uma nova versão externa. O contrato de campo está
em [ENTREGA_HELBER.md](ENTREGA_HELBER.md).

## Domínio e segredos

1. Instalar Docker e Compose na VPS.
2. Apontar `api`, `admin`, `sindico`, `morador` e `mqtt` do domínio para a VPS.
3. Liberar 80/443 para os painéis e 8883 para os gateways.
4. Copiar `infrastructure/.env.prod.example` para `infrastructure/.env.prod` e preencher
   domínio, e-mail e segredos exclusivos. Gerar cada segredo em base64url para evitar
   caracteres especiais em URLs de conexão:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

O Caddy obtém TLS dos quatro serviços web. Para MQTT, obter separadamente um certificado
válido para `mqtt.SEUDOMINIO` e colocar `fullchain.pem` e `privkey.pem` no diretório absoluto
`MQTT_CERTS_DIR`. Os arquivos devem ser legíveis pelo usuário do EMQX. Configurar renovação
e recarga do broker conforme a autoridade certificadora utilizada. O servidor não inicia
MQTTS corretamente sem esses arquivos.

O Compose fixa EMQX 6.3.1. Antes de oferecer o serviço comercialmente, confirmar o
enquadramento da instalação na [licença do EMQX](https://www.emqx.com/en/content/license-faq),
que contém condições para serviços hospedados e produtos embarcados.

## Preparar o banco e iniciar

Na raiz do repositório, em Linux, construir a imagem da API usada pelo bootstrap:

```bash
docker compose -f infrastructure/docker-compose.prod.yml --env-file infrastructure/.env.prod build api
./infrastructure/setup-prod.sh
```

O script aplica as tabelas e todos os arquivos `infrastructure/0*.sql` em ordem, incluindo
`005-audit-insert.sql` e `006-telemetry-read-policy.sql`. A API usa a role restrita `predioon_app`; a ingestão usa a conexão
administrativa interna. O banco vazio exige provisionar o primeiro administrador.
Para um **piloto com dados demonstrativos**, preencher `SEED_PASSWORD` com senha exclusiva
e usar `./infrastructure/setup-prod.sh --seed`. Isso cria as três contas listadas no README
e os sensores de demonstração; não representa um cadastro real do condomínio.

Para atualizar uma instalação existente, fazer backup do banco e executar novamente o
script após atualizar o código. Não usar `infra:reset` em banco com dados reais.

## MQTT de produção

O broker consulta os endpoints internos `/internal/mqtt/authn` e `/internal/mqtt/authz`,
protegidos por `MQTT_AUTH_SECRET`. O Caddy bloqueia esse prefixo na internet.

- O painel emite usuário/senha por gateway e guarda somente o hash da senha.
- O gateway usa `clientId` igual ao próprio ID e publica apenas nos sensores vinculados.
- A ingestão autentica com `MQTT_INGEST_USERNAME` e `MQTT_INGEST_PASSWORD` e só pode assinar
  os filtros autorizados de telemetria/status e confirmações de acessos; também publica comandos somente para acessos habilitados.
- Autorização sem correspondência resulta em negação; o cache de autorização é desativado
  para a desativação do cadastro valer nas novas publicações.
- `infrastructure/emqx/acl.conf` nega tudo como proteção. Não substituir o autorizador
  HTTP por uma ACL genérica permitindo todos os prédios.
- A porta 1883 fica somente na rede interna do Compose. O gateway externo conecta em
  8883 com TLS e validação de certificado. Nunca configurar `rejectUnauthorized: false`.
- Após rotação de senha, desconectar a sessão antiga no broker se for necessária
  revogação imediata. A nova senha é exigida na próxima autenticação.

O status deve usar QoS 1, retenção e Last Will OFFLINE. Configure o identificador de
condomínio/sensor conforme o cadastro, não conforme os IDs ilustrativos da especificação.

## Verificação da instalação

```bash
curl https://api.SEUDOMINIO/health/ready
```

Depois verificar login nos três painéis, cadastro de gateway/sensor, publicação de leitura
por TLS, histórico, regra de nível abaixo de 20%, reconexão sem duplicar amostras e bloqueio
de publicação em outro gateway. Em ambiente de teste, o simulador aceita:

```bash
MQTT_URL=mqtts://mqtt.SEUDOMINIO:8883 SIM_MQTT_USERNAME=USUARIO_EMITIDO SIM_MQTT_PASSWORD=SENHA_EMITIDA SIM_GATEWAY_ID=ID_GATEWAY pnpm simulate:hardware
```

O simulador utiliza os sensores `water_01`, `pump_01`, `phase_01`, `leak_01` e `temp_01`;
todos precisam estar vinculados ao gateway de teste. Ele não deve representar um sensor
físico em uso. `MQTT_CA_FILE` é opcional para uma CA privada confiável.

## Operação

### Atualização com controle de funcionalidades

1. Fazer backup e registrar a versão atual antes de atualizar. Usar o procedimento de migrações do projeto (`pnpm db:infra`) para aplicar também `012-features.sql`. A migração é aditiva: cria configurações globais/locais e estado de pausa/retomada, além de identificar dias de consumo incompletos. Não executar reset ou seed de demonstração em produção.
2. Coordenar a atualização da API e da ingestão: pausar os processos antigos, aplicar migrações, iniciar ambos com a mesma versão e conferir os logs. Não disponibilizar a central administrativa enquanto uma ingestão antiga ainda puder ignorar os controles. Gateways podem manter seu buffer durante a atualização conforme o contrato de telemetria.
3. Publicar os três painéis após API e ingestão estarem atualizadas. Todos os recursos atuais começam habilitados/herdados; os controles existentes de equipamentos e portões continuam valendo.
4. Entrar como administrador da plataforma, abrir **Funcionalidades** e conferir a configuração global e de um condomínio de homologação. Testar desativação/retomada, descarte seletivo de leituras, heartbeat, bloqueio de ações, auditoria e preservação de histórico antes da liberação.
5. Em reversão de versão, impedir alterações na central e não iniciar serviços antigos enquanto houver recursos pausados: uma versão sem esses controles pode voltar a aceitar leituras ou comandos. Preservar as novas tabelas e o histórico; preparar uma versão compatível para a recuperação.

Procedimento operacional e efeitos de cada controle: [FUNCIONALIDADES.md](FUNCIONALIDADES.md).

Configurar backup com teste de restauração, monitoramento de disponibilidade e renovação
de certificados. Retenção/compressão podem ser ativadas nas políticas comentadas em
`001-timescale-rls.sql`. Definir os prazos conforme a operação.

O canal `ALERT_WEBHOOK_URL` envia alertas HIGH/CRITICAL a um integrador de mensagens.
Sem provedor configurado, o sistema mantém os alertas no painel/log. Não há envio direto
implementado para WhatsApp ou e-mail.

Os painéis também podem ser hospedados como arquivos estáticos, compilados com
`VITE_API_URL` da API pública e os rewrites de SPA existentes. API e ingestão exigem processos
permanentes; o banco precisa suportar TimescaleDB e LISTEN/NOTIFY. As URLs Vercel históricas
não foram atualizadas nem validadas nesta entrega.
