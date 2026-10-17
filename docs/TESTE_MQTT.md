# Teste integrado de MQTT / TLS

`services/ingest/scripts/verify-broker.ts` é um teste de aceitação opcional contra um broker
real. A suíte `pnpm test` valida os componentes sem exigir um broker TLS adicional.

## Ambiente necessário

- Banco local preparado com `pnpm setup:local`, contas demo e prédio `bld_001`.
- Instância isolada de EMQX 6.3.1, com autenticação/autorização HTTP equivalentes ao
  Compose de produção, cache desativado e negação como padrão.
- API de teste com acesso ao mesmo banco, `MQTT_AUTH_SECRET` compartilhado com o broker,
  `MQTT_INGEST_USERNAME=predioon_ingest` e senha de ingestão exclusiva.
- Banco com a 052 e as seis roles provisionadas. O teste usa `DATABASE_URL` (dona) só para
  criar e conferir os equipamentos temporários; quem recebe as leituras é o serviço de ingestão
  real, iniciado como processo filho com somente `DATABASE_URL_INGEST` e
  `DATABASE_URL_ACCESS_SERVICE`, que também precisam estar definidas.
- A credencial do gateway é emitida pelo síndico de `bld_001` (padrão `sindico@predioon.local`;
  ajuste com `MQTT_VERIFY_EMAIL`/`MQTT_VERIFY_PASSWORD`). O administrador da plataforma não tem
  acesso implícito aos equipamentos do condomínio.
- Certificado do broker com SAN correspondente ao host, e CA confiável fornecida ao teste.

As URLs internas configuradas no EMQX precisam alcançar essa API. Dentro do Docker no
Windows, `host.docker.internal` alcança o host. Os endpoints são `/internal/mqtt/authn`
e `/internal/mqtt/authz`, com cabeçalho `x-mqtt-secret`; os campos e placeholders usados
pelo broker estão em `infrastructure/docker-compose.prod.yml`.

## Executar

No PowerShell, a partir de `services/ingest`, ajustar para esse ambiente isolado:

```powershell
$env:MQTT_VERIFY_URL = 'mqtts://localhost:9883'
$env:MQTT_VERIFY_API = 'http://localhost:3300'
$env:MQTT_VERIFY_CA_FILE = 'C:/caminho/ca-do-teste.pem'
$env:MQTT_VERIFY_INGEST_PASSWORD = 'senha-da-ingestao-do-teste'
pnpm exec tsx scripts/verify-broker.ts
```

O teste cria gateway, sensor e regra temporários, solicita uma credencial à API, valida o
certificado TLS, publica nível 18% duas vezes e verifica três métricas, um único alerta,
consulta pela API, senha errada e tentativa de publicar no sensor de outro gateway. Ao
terminar, remove os próprios equipamentos e seus dados associados; o registro de auditoria
da emissão de credencial permanece.

Não apontar esse teste para produção: ele depende das contas de demonstração e faz
alterações temporárias no prédio `bld_001`.

Nesta máquina o Avast substitui o certificado do broker de teste por um próprio ("Avast Web/Mail
Shield Untrusted Root"), e o cliente no Windows falha com `unable to verify the first certificate`.
Rode o cliente num container na mesma rede Docker do broker e emita o certificado com o nome
desse host no SAN. Não desative o antivírus nem a validação de certificado.

## Sessão durável com o serviço real

`services/ingest/scripts/ingest-session-rehearsal.mjs` inicia o serviço de ingestão real só com as
duas URLs restritas, para o serviço, publica uma leitura QoS 1, reinicia um EMQX descartável e
confere que a leitura foi gravada exatamente uma vez quando o serviço volta. A URL dona
(`REHEARSAL_ADMIN_DATABASE_URL`) é usada só para as conferências. Como controle, o mesmo ensaio
contra um EMQX sem `EMQX_DURABLE_SESSIONS__ENABLE=true` perde a leitura. Na validação desta entrega, o cliente foi
executado na mesma rede Docker do broker para evitar a interceptação do certificado de
teste pelo antivírus. Não foi desativada a validação de certificado.
