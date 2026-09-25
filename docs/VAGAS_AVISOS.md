# Vagas e avisos programados

## Operação

O painel de vagas mantém capacidades independentes de carros (`CAR`) e motos (`MOTORCYCLE`). A gestão cadastra cada capacidade, informa a ocupação e, opcionalmente, vincula um dispositivo ativo do tipo `PARKING_SENSOR`. Moradores consultam a disponibilidade.

Uma contagem desconhecida aparece como **Sem informação**, nunca como zero. Cada cartão exibe origem e horário da última contagem (`observedAt`). Depois de `staleAfterSeconds` (padrão 300 s, configurável entre 30 s e 24 h), aparece **Desatualizado** e o número de vagas livres fica indisponível. O registro anterior continua identificado como histórico. `updatedAt` registra a última alteração da linha, inclusive configuração; não renova a validade da contagem. O painel consulta a API a cada 15 segundos e reavalia a validade no navegador.

Alterações manuais usam `version` para impedir a perda de uma atualização concorrente; o servidor retorna 409 quando outra operação já alterou a linha. Capacidade e ocupação exigem inteiros não negativos, e a ocupação não pode superar a capacidade. Trocar ou remover o sensor limpa a contagem e exige uma nova leitura ou informação manual.

## Telemetria

Enviar ao tópico `predio/{buildingId}/device/{deviceId}/telemetry`:

```json
{
  "schemaVersion": 1,
  "eventId": "parking-car-20260922T120000Z",
  "buildingId": "bld_001",
  "deviceId": "parking_car_01",
  "metric": "parking_occupied",
  "value": 12,
  "quality": "GOOD",
  "timestamp": "2026-09-22T12:00:00.000Z"
}
```

O dispositivo vinculado determina se a leitura se refere a carros ou motos. Um sensor não pode ser vinculado às duas contagens. A ingestão valida prédio, dispositivo/gateway habilitados e idempotência antes de aplicar a leitura. O hook `applyParkingTelemetry(tx, data)` aceita apenas um inteiro dentro da capacidade, qualidade `GOOD`, horário não futuro e dentro da janela de validade. Mensagens fora de ordem, repetidas, antigas ou não vinculadas não alteram as vagas. Após uma atualização manual, somente uma leitura posterior à contagem manual retoma a origem `SENSOR`.

## Avisos e agenda

O editor oferece atalhos para dia do lixo, reunião e limpeza do hall. Categoria, mensagem, destaque, data do evento, repetição e período de publicação podem ser editados. As reservas de salão e a fila de serviços mantêm seus próprios fluxos existentes.

- **Publicar em (`publishedAt`)** define quando o aviso se torna visível. Vazio no editor publica imediatamente. Moradores nunca recebem avisos antes desse instante; o filtro também está no PostgreSQL RLS.
- **Data e hora do evento (`schedule.startsAt`)** define quando ocorre a coleta, reunião ou limpeza. Pode ser posterior à publicação.
- **Repetição** admite evento único (`NONE`) ou semanal (`WEEKLY`). A próxima ocorrência é calculada na consulta; não são criados avisos duplicados nem é necessário um processo agendador.
- **Encerrar (`expiresAt`)** oculta o aviso e encerra as próximas ocorrências exibidas. Precisa ser posterior à publicação.
- O editor interpreta as datas no fuso IANA escolhido, com padrão `America/Sao_Paulo`, independente do fuso do navegador. A API armazena instantes com offset explícito. A repetição semanal conserva dia e hora locais durante mudanças de horário de verão. Um horário local inexistente ou ambíguo é recusado no cadastro. Na repetição, uma semana com hora inexistente é pulada; hora repetida usa o primeiro instante.

Gestores usam `GET /notices?buildingId=...&includeUnpublished=true&includeExpired=true` para administrar todos os avisos do prédio. Moradores recebem 403 ao solicitar esses filtros administrativos. O aplicativo do morador recarrega os avisos a cada 30 segundos e também filtra a validade localmente. `PATCH /notices/:id` aceita `expectedUpdatedAt` para proteção contra edições concorrentes e `schedule: null` para remover a agenda.

## Banco, permissões e validação

Em banco existente, aplicar `pnpm db:infra`. A migração aditiva `009-parking-notices.sql` cria as tabelas e instala políticas RLS, vínculos de prédio e permissões em `parking_lots` e `notice_schedules`. APIs usam o papel não proprietário, verificam o vínculo ao prédio e exigem gestão nas escritas. A ingestão usa a conexão proprietária com validação explícita de identidade. Alterações e leituras automáticas aceitas geram auditoria na mesma transação.

Testes:

```powershell
pnpm --filter @predioon/api exec tsx --test test/parking-notices-unit.test.ts
pnpm --filter @predioon/api exec tsx --test test/parking-notices.test.ts
pnpm --filter @predioon/ingest exec tsx --test test/parking.test.ts
```

Os testes de integração exigem a infraestrutura local ativa, migrações aplicadas e usuários do seed. Criam e removem prédios isolados para não alterar as vagas do condomínio de demonstração.
