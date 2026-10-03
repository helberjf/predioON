# Entrega durável de alertas — primeiro incremento da etapa3

Estado: desenho e critérios de aceite, sem implementação nem SQL038 publicado. Executar após aceitar/publicar identidade037. Base: [arquitetura aprovada](../specs/2026-09-27-arquitetura-produto-design.md) e [tracker](2026-09-27-product-execution.md). Não encerra inbox, scheduler, automações, comandos separados, push móvel ou credenciais de todas as cargas.

## Problema observado na fonte

Telemetria grava leitura/consumo/alertas atomicamente, mas publica SSE e chama `notifyAlert` depois do commit. Uma queda nesse intervalo deixa o alerta persistido sem webhook; reentregar a telemetria não o recria, porque `ingest_events` já deduplica. O verificador de comunicação também cria alertas antes de chamar o mesmo transporte. `notifyAlert` mantém transação e lock de funcionalidades durante HTTP, ignora resposta HTTP malsucedida e absorve falhas de transporte.

O MQTT já aguarda `handleMessage` antes do PUBACK. O problema atual de notificação não deve ser atribuído a um listener sem await. Antes de separar toda a recepção em inbox, um primeiro incremento de outbox pode fechar a perda de alertas nos produtores existentes, preservando a entrada e atuação atuais.

Fontes: [telemetry.ts](../../../services/ingest/src/pipeline/telemetry.ts), [offline-sweeper.ts](../../../services/ingest/src/offline-sweeper.ts), [notify/index.ts](../../../services/ingest/src/notify/index.ts), [features-lifecycle.test.ts](../../../apps/api/test/features-lifecycle.test.ts).

## Recorte proposto e dados

- SQL038 novo: `outbox_events` imutável com ID, tipo/versão, building, agregado/alertId, criação e correlação mínima; não duplicar mensagem privada, telemetria bruta ou credenciais. Uma entrega por evento/consumidor/ação em `event_deliveries`, com unicidade, estado, tentativas, disponibilidade, lease, token de reserva e categoria de falha sanitizada.
- Todos os produtores existentes de alerta, inclusive comunicação/offline e consumo, escrevem a outbox na mesma transação do alerta. Revisar os pontos de inserção com busca no repositório; não retirar o transporte direto deixando um produtor sem enqueue. Eventos anteriores não são reenviados automaticamente durante a migração.
- Worker dedicado de webhook reserva um lote pequeno com `SKIP LOCKED`, consulta o alerta e sua elegibilidade atual e finaliza a transação antes de HTTP. Confirma/reagenda somente enquanto o token e lease forem atuais, usando relógio do banco após esperas. Trigger que ignora/reverte escrita não pode produzir confirmação positiva.
- Respostas2xx confirmam a tentativa; rede/timeout/429/5xx recebem atraso limitado, classificação e máximo de tentativas. Erros definitivos ficam inspecionáveis; respeitar Retry-After limitado. Enviar chave de idempotência estável por evento/consumidor/ação. Sem contrato de idempotência do provedor, a entrega é pelo menos uma vez e pode duplicar após queda entre efeito externo e confirmação.
- `NOTIFY` acorda o worker; polling recupera sinais perdidos. Definir limpeza separada para eventos entregues, pendências e falhas, sem apagar deduplicação ainda necessária.

## Preservar pausa versus tentativa em andamento

O teste atual exige que uma pausa aguarde uma entrega já iniciada, e que o alerta antigo não seja entregue depois. Revalidar e chamar HTTP sem barreira cria uma corrida; mudar o teste para aceitar essa corrida enfraqueceria o contrato.

Uma opção a provar é manter a barreira compartilhada existente `(814772,1)` na sessão dedicada do worker, enquanto a API continua com o lock exclusivo transacional. A conexão deve ser reservada durante a tentativa, sem devolver ao pool e sem manter transação aberta durante HTTP. Adquirir barreira → reservar/revalidar por token → commit → HTTP com timeout → registrar resultado → liberar em finally. Prazo da reserva precisa cobrir a tentativa; depois de esperar barreira, revalidar relógio/token/configuração antes de enviar. Se falhar o unlock, destruir a conexão. Medir concorrência e espera para que uma fila não bloqueie indefinidamente a administração.

Locks de sessão e transação sobre o mesmo identificador interagem; o lock de sessão exige liberação explícita ou término da sessão. Essa opção preserva a serialização normal, mas ainda exige testes de falha da conexão durante HTTP e cancelamento. Não prometer cancelamento de um efeito externo já recebido. Referências: [PostgreSQL16 — advisory locks](https://www.postgresql.org/docs/16/explicit-locking.html#ADVISORY-LOCKS), [funções de lock](https://www.postgresql.org/docs/16/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS).

Pausa deve cancelar definitivamente entregas pendentes inelegíveis; retomar não ressuscita alertas anteriores. Registrar geração/instante de configuração e usar as regras atuais de `permitsAlert`, incluindo alertas de comunicação. Não usar bloqueio global da aplicação como autorização de tenant.

## Credenciais e implantação

Criar papel de notificações sem owner, memberships, BYPASSRLS ou DDL. O processo só reserva/revalida/conclui entregas através das interfaces privadas necessárias; tenant/alerta vêm da linha reservada, não de parâmetros arbitrários do worker. Owner, search_path e ACLs explícitos e verificáveis. API/app/identidade/broker não recebem mutação da fila ou execução dos helpers do worker.

Estender runtime-connection, provisionamento, registro de roles do executor, exports/fronteiras e Compose. A ingestão legada continua proprietária enquanto telemetria/ACK/comandos/offline não forem extraídos; marcar2B.5 parcial. Não anunciar privilégio mínimo completo a partir de um único worker separado.

Coordenar rollout: pausar produtores antigos, aplicar038, iniciar produtores novos sem entrega direta e worker novo, conferir prontidão. Não misturar releases que enviem o mesmo alerta diretamente e pela outbox. Sem URL do webhook configurada, definir estado explícito de destino ausente; não confirmar silenciosamente entrega inexistente nem criar backlog ilimitado.

## RED e aceite

1. Queda depois do commit do alerta, antes do transporte: outbox deve sobreviver e o novo processo entregar. Queda antes do commit não deixa alerta/evento parcial.
2. Dois workers concorrentes não possuem o mesmo token ativo; worker com lease vencido não conclui nem grava efeitos de banco. Queda após HTTP antes de confirmação pode repetir somente com a mesma chave de idempotência.
3. Webhook lento/500/429/timeout não mantém transação aberta nem bloqueia ingestão; atraso, máximo de tentativas e falha terminal são conferidos no banco real.
4. Pausa concorrente com HTTP mantém o contrato atual; novas tentativas pendentes são canceladas e retomada não ressuscita alertas antigos. Interrupção da conexão libera a barreira e não deixa locks/famílias de pool presos.
5. Alertas de regra, consumo e comunicação chegam pela mesma outbox; nenhuma alteração em comandos físicos. Assertar ausência de publish/replay físico em todos os retries do worker.
6. Negativas SQL de credenciais indevidas, forja de tenant/token, mudanças silenciosas por triggers e acesso a credenciais/payload alheios. Não usar owner no worker para fazer testes passarem.
7. Aplicação/reaplicação via ledger, checksum/ACL e restore das novas tabelas/helpers/estados. Tipos/fronteiras/builds, ingestão integral, API lifecycle integral e ensaio crash com processos reais, sem somar dirigidos como integral.

## Incrementos seguintes da etapa3

Inbox com envelope e geração de funcionalidades; receiver e worker de telemetria restritos; dedup gateway/eventId e serialização de consumo; heartbeat pelo recebimento; ACK em fila própria prioritária; scheduler e automações. O ledger atual tem PK global por eventId: a inbox nova não resolve a colisão enquanto o ledger antigo permanecer. Planejar migração compatível dos eventos existentes sem inventar gateway histórico.

Comandos físicos mantêm QoS0, retain:false, fila desativada, prazo e commit SENT antes de publicar. Falta de ACK, lease ou retomada de notificação nunca autoriza reenviar comando. Separar posteriormente a credencial MQTT de recepção da credencial que publica comandos.
