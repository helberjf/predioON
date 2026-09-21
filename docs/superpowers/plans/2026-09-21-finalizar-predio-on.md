# Prédio ON — finalização da integração e dos painéis

**Objetivo:** entregar o sistema existente funcionando localmente, com a mensagem de caixa d'água fornecida pelo usuário, alertas configuráveis e interfaces coerentes com as referências, sem acionamento de portões.

**Arquitetura:** preservar React/Vite, API Express, ingestão Node, EMQX e PostgreSQL/TimescaleDB. O gateway lê Modbus e publica MQTT; a plataforma normaliza o contrato compacto para métricas internas, grava transacionalmente e atualiza o painel por SSE. Dados de demonstração são identificados, sem representar sensores físicos conectados.

## Entregas e verificação

- [x] Compatibilidade com `predio/{buildingId}/caixa_agua/{sensorId}/telemetria` e JSON `device_id`, `type`, `nivel_percentual`, `distancia_mm`, `volume_litros`, `timestamp`. Preservar contrato genérico. Testar valores inválidos, identidade, reenvio e métricas opcionais.
- [x] Gravação atômica das métricas e emissão SSE apenas após gravação aceita. Testar nível de 18% contra regra de 20%, dispositivo desativado e duplicação.
- [x] Corrigir falhas reais encontradas nos testes existentes, incluindo cadastro/auditoria com RLS.
- [x] Melhorar painéis existentes (administrador, síndico e morador), usando azul-marinho, verde, cartões claros e navegação responsiva das referências. Leituras e gráficos vêm da API; seleção de sensores funciona sem IDs fixos; estados de carga/erro/ausência são explícitos. Nenhum botão de portão.
- [x] Preparar configuração MQTTS com validação de certificado, credenciais por gateway e isolamento de publicação no broker. Documentar valores de instalação que dependem do equipamento e certificados reais.
- [x] Atualizar documentação técnica para Helber, comandos locais e limites reais da entrega.
- [x] Executar testes, verificação de tipos, build, fluxo MQTT → banco → alerta → API e inspeção das interfaces no navegador. Revisar mudanças antes de entregar.

## Escopo de campo

Registradores Modbus, credenciais de provedor de mensagens e certificado de domínio dependem da instalação. Não inventar esses dados nem declarar comissionamento físico realizado. IA permanece evolução posterior conforme a especificação.
