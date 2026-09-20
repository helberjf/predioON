# Plano total da plataforma Prédio ON

## 1. Objetivo

Centralizar monitoramento de infraestrutura predial, histórico de telemetria, alertas e análise de anomalias. Nesta versão não existe acionamento remoto de portões.

## 2. Perfis

### Administrador da plataforma
- organizações/clientes;
- prédios;
- gateways;
- dispositivos e métricas;
- usuários;
- alertas;
- auditoria;
- saúde da infraestrutura.

### Administrador do prédio
- visualizar dispositivos do próprio prédio;
- acompanhar telemetria e alertas;
- reconhecer/resolver alertas;
- configurar limites e regras;
- consultar histórico e relatórios.

### Morador
- visualizar apenas informações autorizadas do condomínio;
- acompanhar avisos e alertas liberados;
- sem comandos físicos sobre equipamentos.

## 3. Arquitetura

```text
Sensores
  ↓ RS485 / Modbus RTU / entradas digitais
Gateway industrial
  ↓ MQTTS
EMQX
  ↓
Node.js ingest + mqtt.js + Zod
  ↓
PostgreSQL + TimescaleDB
  ↑
Express 5 + TypeScript
  ↑
React/Vite: Admin | Prédio | Morador
```

## 4. Responsabilidades

- **Gateway:** coleta e normalização básica dos dados de campo.
- **EMQX:** transporte MQTT seguro e desacoplado.
- **Ingest:** validação, idempotência, persistência, atualização de status e avaliação de regras.
- **API:** autenticação, RBAC, consultas, cadastros, configuração e auditoria.
- **Painéis:** visualização, configuração e operação administrativa.
- **TimescaleDB:** histórico temporal e agregações.

## 5. Fluxo de telemetria

1. Sensor mede uma grandeza.
2. Gateway lê o dado.
3. Gateway converte para JSON padronizado.
4. Publica em `predio/{buildingId}/device/{deviceId}/telemetry`.
5. Ingest valida com Zod.
6. `eventId` é usado como trava de idempotência.
7. Telemetria é persistida.
8. Regras de alerta são avaliadas.
9. Painel consulta API e exibe o estado.

## 6. Regras de alerta

Exemplos:

- nível da caixa < 20%;
- tensão abaixo do limite;
- temperatura acima do limite;
- vazamento detectado;
- fumaça detectada;
- bomba ligada por tempo anormal.

## 7. Segurança

- MQTTS;
- credencial/certificado por gateway;
- ACL por prédio;
- RBAC na API;
- PostgreSQL RLS;
- logs de auditoria;
- validação de payload;
- nenhum acesso direto do navegador ao broker ou aos dispositivos de campo.

## 8. IA futura

A IA entra para detecção de anomalias e tendências, não para substituir regras determinísticas simples. Exemplos: queda de nível anormalmente rápida, consumo fora do padrão, bomba operando por tempo incomum ou combinação de sinais elétricos fora do comportamento histórico.

## 9. Entidades principais

- users
- organizations
- buildings
- memberships
- gateways
- devices
- device_metrics
- ingest_events
- telemetry
- alert_rules
- alerts
- audit_logs

## 10. Fases

### Fase 1 — piloto
Gateway + sensores de nível, fase, vazamento e temperatura; dashboard e alertas.

### Fase 2 — operação
Autenticação real, CRUD administrativo, notificações, relatórios e observabilidade.

### Fase 3 — escala
Provisionamento automático de gateways, certificados, retenção/compressão TimescaleDB e alta disponibilidade.

### Fase 4 — inteligência
Detecção de anomalias e manutenção preditiva.
