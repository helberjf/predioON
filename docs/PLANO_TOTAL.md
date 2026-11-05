# Plano total da plataforma Prédio ON

> Direção de produto atualizada em 27/09/2026: a [arquitetura de produto e escala](superpowers/specs/2026-09-27-arquitetura-produto-design.md) é a referência para a evolução. Ela define App Morador, App Operação (síndico/manutenção), web do síndico e web da plataforma, com backend central modular, RBAC por capacidade e workers por carga. Este arquivo registra a arquitetura e as etapas da implementação existente; não comprova a implementação da nova proposta.

## 1. Objetivo

Centralizar monitoramento de infraestrutura, histórico, consumo, alertas e rotina do imóvel. A análise histórica usa referência estatística aprendida de consumo e tempo de bomba. O módulo de acessos solicita abertura remota de portões autorizados e exige confirmação do controlador.

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
- solicitar abertura dos acessos liberados pela administração;
- consultar consumo, vagas, avisos, reservas e chamados.

## 3. Arquitetura

Estado atual: os serviços e painéis foram validados localmente com telemetria simulada.
O firmware, a leitura dos sensores físicos e o comissionamento dependem da instalação.
O que falta para produção está em [NEXT_STEPS.md](NEXT_STEPS.md); o roteiro de publicação
está em [DEPLOY.md](DEPLOY.md). A cobertura da lista solicitada está em
[REVISAO_FUNCIONALIDADES.md](REVISAO_FUNCIONALIDADES.md).

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

O motor atual compara cada leitura com um limite fixo. Exemplos presentes no cadastro de demonstração:

- nível da caixa < 20%;
- tensão abaixo do limite;
- temperatura acima do limite.

O seed complementar inclui regras de vazamentos de água/esgoto, gás e relé da central de incêndio, além de limites nas três fases. Os contratos e cenários de simulação estão em [SENSORES.md](SENSORES.md). A integração física depende do equipamento e do comissionamento.

O módulo de consumo calcula diferenças dos medidores acumulados, custo estimado por tarifa e tempo de bomba. Limites diários e contínuos e a referência histórica podem gerar alertas. Lacunas e resets ficam sem cálculo; a cobertura é exibida. Veja [CONSUMO_E_ANALISE.md](CONSUMO_E_ANALISE.md).

## 7. Segurança

- MQTTS;
- credencial/certificado por gateway;
- ACL por prédio;
- RBAC na API;
- PostgreSQL RLS;
- logs de auditoria;
- validação de payload;
- nenhum acesso direto do navegador ao broker ou aos dispositivos de campo.

## 8. Análise histórica e evolução preditiva

O modelo atual aprende mediana e variação robusta com até 28 dias válidos e sinaliza aumentos de consumo ou duração de bomba. Sem histórico suficiente, informa aprendizado. Previsão de falhas, correlação de múltiplos sensores e diagnóstico de causa permanecem evoluções futuras.

## 9. Entidades principais

**Identidade e acesso:** `users`, `refresh_tokens`, `organizations`, `buildings`, `memberships`
**Campo:** `gateways`, `devices`, `device_metrics`
**Telemetria:** `ingest_events` (idempotência), `telemetry` (hypertable)
**Operação:** `alert_rules`, `alerts`, `audit_logs`
**Convivência:** `notices`, `occurrences`, `occurrence_events`, `common_areas`, `reservations`

## 10. Fases

### Fase 1 — piloto ✅ concluída
Sensores de nível, fase, bomba, vazamento e temperatura; dashboard, alertas e histórico.
Validada de ponta a ponta com o simulador de campo, sem hardware.

### Fase 2 — operação ✅ concluída
Autenticação real (JWT + argon2 + refresh rotativo), RLS efetiva com role não-dona,
CRUD administrativo completo, auditoria, tempo real por SSE, detecção de offline,
chamados, avisos e reservas de áreas comuns.

### Fase 3 — escala ⏳ em aberto
MQTTS com certificado individual por gateway, provisionamento ampliado,
retenção/compressão no TimescaleDB e alta disponibilidade.

A sequência revisada está na [arquitetura de produto](superpowers/specs/2026-09-27-arquitetura-produto-design.md): contratos, identidade/RBAC, processamento durável e separação de cargas, módulos de manutenção/automações/planos, aplicativos e operação verificada. O autorizador HTTP já existe na configuração atual; provisionamento ampliado, validação de certificados individuais, escalabilidade e alta disponibilidade precisam ser tratados conforme o estado real de cada instalação.

### Fase 4 — análise histórica implementada e validada localmente
Detecção estatística de desvios de consumo e bomba implementada. A validação integrada desses módulos, concluída em 23/09/2026, ficou no histórico do git (`git show 6ee13e4:docs/REVISAO_FUNCIONALIDADES.md`); as verificações atuais estão em [REVISAO_FUNCIONALIDADES.md](REVISAO_FUNCIONALIDADES.md). Instalação e comissionamento dos equipamentos físicos continuam necessários; manutenção preditiva permanece futura.


## Entregas finais confirmadas em 05/11/2026

**Escopo de encerramento confirmado pelo proprietário em 05/11:** concluir Android, iOS, webapps e APIs com seus fluxos; validar a matriz completa com Playwright e usar codegen para registrar/verificar jornadas; entregar scripts para abrir os sistemas e instruções de uso; preparar um documento para explicar todos os sistemas em entrevistas e apresentações. Esses materiais finais devem refletir o sistema efetivamente validado. Imagens versionadas, vídeos atualizados e documentação completa continuam no plano. **Não reiniciar o computador nesta sessão.**

- [ ] Concluir as funções e jornadas atuais dos apps Android/iOS, portais web e APIs, com provas nas fontes finais.
- [ ] Fechar a matriz Playwright com backend real, registrar/verificar os fluxos com codegen e revisar navegador, acessibilidade e erros de console/rede.
- [ ] Validar scripts para abrir os sistemas e documentar pré-requisitos, portas, comandos, encerramento e solução de problemas.
- [ ] Entregar o roteiro para entrevistas/apresentações: públicos, jornadas, arquitetura, integrações, testes, decisões e limites reais.
- [ ] Atualizar capturas, vídeos e documentação final sem confundir evidências históricas com homologação atual.

Primeiras versões dos materiais: [roteiro para entrevistas](ROTEIRO_ENTREVISTA.md)
e [guia de abertura dos sistemas](COMO_ABRIR_OS_SISTEMAS.md). Ainda precisam de
revisão na fonte final e execução observada dos launchers/jornadas. O launcher
passou [8/8 cenários isolados no PowerShell 7](evidencias/launcher-behavior-pwsh7-2026-11-05.json),
sem serviços reais. A tentativa no Windows PowerShell ficou
[bloqueada antes do primeiro caso](evidencias/launcher-preflight-2026-11-05.json).
Os itens acima continuam abertos.

Consultar o estado corrente e a sequência de retomada em [CONTINUIDADE.md](CONTINUIDADE.md).
