# MFA: próximo recorte do fluxo de telemetria

Estado em 05/11/2026: **desenho revisado, ainda não implementado ou executado**.
Parte do [checkpoint composto de MFA](../../continuidade/2026-11-05-mfa-integracao/README.md),
com a correção de desativação e eventos de funcionalidades. Não altera SQL 001–067
nem representa aceite de produção. [Prova da composição de partida](../../evidencias/mfa-feature-events-2026-11-05.json).

## Problema e contrato a preservar

O projector `apps/api/src/modules/events/telemetry.ts` consulta capacidades e
estados das funcionalidades em instruções distintas. O gate HTTP anterior não
protege essas instruções de uma promoção administrativa intermediária.

Atualmente os valores do evento vêm de NOTIFY: o projector não relê uma amostra
persistida. Leitores de dados brutos recebem o evento validado; leitores de dados
publicados recebem a projeção sanitizada de água. Os 13 testes originais desse
fluxo também publicam notificações sintéticas sem inserir amostras.

O evento não tem identificador único da amostra. A chave da tabela é `(id,time)`,
não a combinação de prédio/dispositivo/métrica/horário do evento. Exigir releitura
persistida, escolher uma linha arbitrária ou usar a última amostra mudaria o
contrato. Autenticidade do valor persistido exige um recorte separado de protocolo,
com identificador de evento/amostra e evolução compatível da ingestão.

## Implementação proposta

1. Acrescentar somente à SQL candidata 068 um envelope escalar, por exemplo
   `app_mfa_telemetry_event_context(text,text) RETURNS jsonb`, STABLE, INVOKER e
   não STRICT. Primeiro executar `app_require_session_mfa()`, inclusive para
   argumentos nulos, inexistentes ou sem escopo.
2. No mesmo snapshot, consultar os helpers existentes de dispositivos autorizados
   com as capacidades fixas `telemetry:read` e `telemetry:read-published`. Retornar
   somente classificação mínima, autoridade e os estados globais/locais e horários
   de retomada que o projector já usa. Não conceder novas permissões de tabela.
3. Preservar RLS, owner controlado, search_path fixo e normalização de ACL para
   EXECUTE exclusivo da aplicação. Serviços continuam sem sessão humana.
4. Trocar as leituras do projector por essa única chamada. Reutilizar as funções
   puras `resolveFeatures`, `telemetryFeatureKeys` e `observationIsCurrent`, sem
   duplicar as regras em SQL. Manter o lock de funcionalidades existente e aguardar
   o término da transação antes de enviar qualquer frame.
5. Preservar a prioridade de leitura bruta e seus tipos/campos. O fallback publicado
   continua exclusivo de `water_level_percent`, número finito entre 0 e 100,
   unidade `%`, qualidade padrão `UNCERTAIN`, horário ISO e o DTO atual. Manter a
   comparação estrita com `resumedAt`; não converter horários arbitrários em SQL.

## Verificação necessária

- Criar teste dirigido separado, com fontes anterior/corrigida e hashes preservados.
- Em SSE real, confirmar um frame positivo exato para leitor local comum. Na mesma
  conexão, pausar depois da identidade/contexto e antes da projeção, ativar binding
  ADMIN preexistente, liberar e verificar fechamento sem frame na versão corrigida.
- Não usar somente um marcador posterior de funcionalidades para detectar a falha:
  esse projector já protegido pode fechar a conexão depois de um vazamento anterior.
- Cobrir PMF01/PMF02, sessão ausente/estrangeira, leitura bruta/publicada, escopo,
  funcionalidades pausadas/retomadas, DTO e ACL dos seis serviços, sem skips novos.
- Reexecutar os testes originais aplicáveis, adaptando autenticação de fixtures
  explicitamente quando necessário; repetir os recortes MFA já integrados.
- Manter barreiras e cleanup limitados, banco UUID próprio e provas separadas.

## Fora deste recorte

Alertas relêem registros persistidos; equipamentos têm classificação e estado
próprios. Precisam de envelopes e testes específicos depois da telemetria. Também
continuam pendentes heartbeat, demais domínios/mutações, expiração após locks,
regressão integrada, navegador, aparelhos e operação real. Este desenho não
autoriza afirmar que essas partes foram implementadas ou homologadas.
