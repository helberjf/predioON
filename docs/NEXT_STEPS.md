# Próximos passos — Prédio ON

1. Finalizar CRUD de organizações, prédios, gateways, dispositivos e métricas no painel administrador.
2. Criar gráficos históricos por dispositivo/métrica usando TimescaleDB.
3. Criar tela de configuração de regras de alerta.
4. Adicionar atualização em tempo real via WebSocket/SSE para telemetria e alertas.
5. Configurar EMQX com MQTTS (8883), credencial/certificado por gateway e ACL por prédio.
6. Implementar heartbeat e detecção de gateway/dispositivo offline.
7. Adicionar autenticação real e substituir `devAuth.ts`.
8. Adicionar testes de integração para tenant isolation, idempotência MQTT e RLS.
9. Implementar notificações por e-mail/WhatsApp para alertas críticos.
10. Adicionar observabilidade (logs estruturados, métricas e tracing).
11. Depois do histórico suficiente, criar serviço de detecção de anomalias.
