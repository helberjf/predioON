# MFA: próximo recorte do projector de alertas

Estado em 05/11/2026: **desenho revisado, sem implementação ou testes deste
recorte**. Parte do [checkpoint composto de MFA](../../continuidade/2026-11-05-mfa-integracao/README.md),
que já preserva desativação, eventos de funcionalidades e telemetria candidatos.
A [prova dirigida da telemetria](../../evidencias/mfa-telemetry-events-2026-11-05.json)
não aprova o projector de alertas nem representa implantação da política.
Não reescrever SQL 001–067.

## Problema e contrato a preservar

`apps/api/src/modules/events/alerts.ts` consulta autorização/contexto no helper
SD, relê o alerta persistido e depois consulta funcionalidades em instruções
separadas. O gate HTTP anterior não compartilha necessariamente a observação
de autoridade administrativa dessas leituras. As políticas MFA candidatas
ainda não cobrem a tabela de alertas.

Este projector tem um contrato diferente do de telemetria: a notificação fornece
identificadores; mensagem, status e associação de gateway vêm do registro
persistido. O recorte deve conservar essa releitura e o DTO de nove campos.
Não confiar em valores forjados ou antigos da notificação, escolher outro alerta
ou acrescentar capacidades de devices/telemetry como pré-requisito de alerts:read.

## Implementação proposta

1. Acrescentar somente à SQL candidata 068 um envelope escalar
   `app_mfa_alert_event_context(text,uuid) RETURNS jsonb`, STABLE, INVOKER e não
   STRICT. Primeiro executar `app_require_session_mfa()`, inclusive para argumentos
   nulos, inexistentes ou sem escopo; preservar PMF01/PMF02 e seu mapeamento.
2. No mesmo snapshot, consultar o helper existente `app_alert_authorized_contexts`
   para o par exato de prédio/alerta, reler somente os campos persistidos usados
   pelo DTO e `triggeredAt`, e capturar os estados globais/locais e horários de
   retomada. As leituras de tabela continuam sob RLS do chamador, sem novo SELECT.
3. Retornar contexto mínimo autorizado, registro persistido e estados de
   funcionalidades. Sem autorização/registro, retornar contexto vazio depois do
   guard; não inferir motivo MFA de zero linhas. Não alterar helpers RBAC puros,
   papéis de serviços, transições de alertas ou emissão de notificações.
4. Usar owner controlado, search_path fixo, referências qualificadas e a mesma
   normalização de ACL exclusiva da aplicação, incluindo a nova assinatura.
5. Substituir as leituras do projector por uma chamada. Reutilizar as funções
   puras `alertFeatureKeys`, `resolveFeatures` e `observationIsCurrent`, preservando
   regras de alertas adaptativos/diários/pump, métricas de regra, gate/parking e
   comparação estrita com `resumedAt`. Converter timestamps JSON explicitamente.
6. Conservar gatewayId nulo e os nove campos de saída. Manter o descarte atual de
   UUID inválido da notificação, que não lê conteúdo privado. Argumentos nulos
   chamados diretamente no SQL ainda devem entrar no guard.
7. Manter o lock existente de funcionalidades e aguardar a transação terminar
   antes de escrever qualquer frame. Uma eventual extração do pequeno adaptador
   puro compartilhado com telemetria precisa ser explícita e ter regressão; não
   duplicar as regras de métricas/dependências em SQL.

Paths previstos: SQL candidata 068, `modules/events/alerts.ts` e um teste dirigido
novo. Um adaptador puro compartilhado pode exigir alteração mecânica separada
na telemetria. Não ampliar esta entrega para outbox, regras, reservas, comandos
ou todos os domínios.

## Verificação necessária

- Criar fontes anterior/corrigida isoladas com hashes e fixture UUID oficial.
- Em SSE real, confirmar um frame positivo reconstruído do alerta persistido,
  com campos forjados da notificação ignorados. Na mesma conexão, pausar depois
  da identidade/contexto e antes da projeção, ativar binding ADMIN preexistente
  e liberar. A versão corrigida deve encerrar sem frame de alerta; o comparador
  deve observar e decodificar o frame recebido para limitar precisamente a prova.
- Não usar somente marcador de funcionalidades posterior como observação: ele
  pode fechar a conexão depois de um frame de alerta já emitido.
- Cobrir PMF01/PMF02, sessão ausente/estrangeira/malformada e contexto vazio/nulo;
  prova de família satisfeita não cria uma capacidade local de alertas.
- Cobrir escopos exatos de alerta/dispositivo/gateway/prédio, IDs divergentes,
  ausência, campos persistidos atuais, sobreposição sem duplicação e suporte
  com alerts:read independente de leitura de dispositivos/telemetria.
- Cobrir pausa/retomada, igualdade com resumedAt, classificação e precedência de
  métricas, e ACL/owner/search_path/STABLE/INVOKER dos seis papéis efetivos.
- Reexecutar os 17 testes originais de `alert-events-capabilities.test.ts` e os
  recortes MFA aplicáveis. Adaptar autenticação de fixtures legitimamente, sem
  retirar assertivas administrativas, desativar a política ou criar skips.
- Conservar barreiras, prazos e cleanup limitados; distinguir erro de preparo,
  contrato SQL ausente, negativa de recurso e falha comportamental demonstrada.

Os testes originais já descrevem persistência/DTO, grants diretos/equipe/recurso,
suporte e janelas, identidades globais sem grant local, IDs inválidos, mudanças
persistidas, pais ativos, funcionalidades, eventos irmãos e revogação de
sessão/conta. Essa lista identifica oráculos existentes; não declara nova execução.

## Fora deste recorte

Equipamentos, heartbeat/headers iniciais, outros callers HTTP dos helpers SD,
mutações sem correspondência, funções VOLATILE, expiração após locks, defaults
ACL/triggers adversariais e operação integrada continuam pendentes. Validar
navegador, aparelhos e produção exige trabalho separado. A observação do SQL
não estabelece linearização com alterações posteriores ao snapshot ou à rede.
