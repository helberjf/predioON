# Próximos passos — Prédio ON

## Concluído

1. ~~CRUD de organizações, prédios, gateways, dispositivos e métricas~~ — feito.
2. ~~Gráficos históricos por dispositivo/métrica com TimescaleDB~~ — `time_bucket` em `/telemetry/series`.
3. ~~Tela de configuração de regras de alerta~~ — painel do prédio, aba Regras.
4. ~~Atualização em tempo real~~ — `LISTEN/NOTIFY` do PostgreSQL relegado a SSE em `/events/stream`.
5. ~~Heartbeat e detecção de gateway/dispositivo offline~~ — `services/ingest/src/offline-sweeper.ts`.
6. ~~Autenticação real substituindo `devAuth.ts`~~ — JWT + argon2 + refresh rotativo.
7. ~~Testes de isolamento, idempotência e RLS~~ — `pnpm test`.

## Em aberto

1. **MQTTS em produção (8883)** com certificado por gateway. Hoje o broker local roda em 1883 sem TLS.
2. **Autorizador HTTP do EMQX** para amarrar cada gateway ao próprio prédio já no broker
   (hoje a amarração é feita na ingestão). Ver `infrastructure/emqx/acl.conf`.
3. **Notificações por e-mail e WhatsApp.** O canal de webhook já existe
   (`ALERT_WEBHOOK_URL`); falta ligar num provedor.
4. **App nativo do morador** em Expo, reaproveitando `@predioon/ui` e a mesma API.
5. **Anexo de foto nos chamados** — precisa de armazenamento de objetos (S3/R2).
6. **Observabilidade**: logs estruturados, métricas e tracing.
7. **Detecção de anomalias** depois de acumular histórico: consumo noturno fora do padrão,
   bomba com mais partidas que a média, queda de nível anormalmente rápida.
8. **Retenção e compressão no TimescaleDB** — as políticas estão comentadas em
   `infrastructure/001-timescale-rls.sql`, prontas para ligar quando o volume justificar.
