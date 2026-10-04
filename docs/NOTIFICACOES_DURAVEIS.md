# Notificações duráveis — incremento038

Estado em03/10/2026: SQL038, serviço, produtores, credencial, implantação/CI e testes integrados nesta linha. Os testes locais correspondentes passaram; conferir o novo CI pelo commit exato. Não houve implantação real nem aceite de produção. O patch038 histórico é obsoleto; usar a main e consultar [CONTINUIDADE](CONTINUIDADE.md) antes de executar.

## O que muda

Uma queda entre o commit do alerta e o envio direto podia perder o webhook definitivamente. Telemetria, consumo, regras, comunicação dos dispositivos e transição do gateway para OFFLINE passam a gravar alerta e evento na mesma transação. Gateway OFFLINE, alerta e evento também passam a ser atômicos. Falha de SSE após o commit não desfaz nem perde a entrega persistida. A confirmação MQTT continua dependendo da conclusão da transação de origem.

`outbox_events` guarda a identidade imutável do evento, sem copiar mensagem privada ou telemetria bruta. `event_deliveries` guarda consumidor, ação, estado, disponibilidade, tentativas, lease e token. `delivery_witnesses` e `delivery_witness_features` conservam as condições/generações que autorizavam a entrega. `notification_attempts` vincula a tentativa à sessão física do banco.

Todos os alertas novos elegíveis podem registrar evento; somente severidade HIGH/CRITICAL cria entrega de webhook. Não há replay automático dos alertas anteriores à migration. O novo worker não publica MQTT nem reenvia comandos físicos.

## Processo e credencial

O serviço `@predioon/notifications` usa exclusivamente `DATABASE_URL_NOTIFICATIONS`, com usuário `predioon_notifications`. A variável é obrigatória inclusive em desenvolvimento/teste; não há alternativa pela conexão proprietária. A configuração e a identidade efetiva do backend são verificadas antes de reservar trabalho. A role não pode ser owner, administradora, membro de outras roles ou possuir memberships de entrada. Ela usa cinco helpers de tentativa; não recebe leitura/mutação direta das tabelas privadas.

O provisionamento recebe owner e quatro DSNs restritos, todos apontando ao mesmo host/porta/banco. As migrations criam/endurecem roles; o provisionador habilita login com as novas credenciais. Fazer isso somente no ambiente correto, com os processos coordenados. Roles e senhas são globais ao cluster; bancos diferentes no mesmo cluster não isolam uma alteração de role. Consulte [CREDENCIAIS_BANCO.md](CREDENCIAIS_BANCO.md).

| Configuração | Uso |
| --- | --- |
| `DATABASE_URL_NOTIFICATIONS` | DSN restrito próprio; nunca inserir no Git, evidências ou linha pública de log. |
| `ALERT_WEBHOOK_URL` | Destino único HTTP(S), sem usuário/senha ou fragmento. Em produção exige HTTPS. Vazio resulta em `no_destination`. |
| `NOTIFICATION_HEALTH_FILE` | Arquivo de saúde privado; padrão no diretório temporário. Usar caminhos distintos para vários workers no mesmo sistema de arquivos. |

No Compose de produção o serviço não expõe porta, recebe apenas seu DSN/destino e executa Node como processo principal. O probe verifica um ciclo recente e um processo existente; não garante disponibilidade do destinatário nem sucesso de todas as entregas. Um heartbeat herdado do mesmo PID é invalidado antes de conectar no novo processo. O probe reprova startup pendente e falha de banco. O encerramento aborta tanto a conexão inicial/LISTEN quanto a tentativa em curso.

## Reserva, transporte e confirmação

Cada tentativa usa um cliente próprio `max:1`, autenticado e reservado. `LISTEN` usa outro cliente. A barreira compartilhada `(814772,1)` fica na sessão da tentativa; a API usa a barreira exclusiva transacional para pausar funcionalidades. Os helpers SQL executam em autocommit. Durante HTTP o backend está idle, sem transação aberta, e a sessão mantém somente a barreira necessária.

O worker reserva uma entrega por vez com `SKIP LOCKED`, revalida token/lease/elegibilidade e envia um único POST. A lease é20s; o HTTP tem limite de5s e redirects recusados. `NOTIFY` é um sinal de despertar; polling de1s recupera sinais perdidos. Não há fila volátil de envios nem retry inline do POST.

Payload do webhook: `alertId`, `buildingId`, `deviceId`, `severity`, `type`, `message`, `triggeredAt`. Esses dados são privados e só devem ir para o destino configurado para essa operação. Respostas do provedor não são lidas/logadas; erros publicam categorias fechadas, sem URL, conteúdo do alerta ou credenciais.

A chave `Idempotency-Key` é `<eventId>/webhook/alert.raised.v1` e permanece igual em todas as tentativas. O destino precisa deduplicar por essa chave antes de aplicar seu efeito. Uma queda após o efeito externo e antes da confirmação pode repetir o POST. A entrega é **pelo menos uma vez**; não existe garantia de efeito externo exatamente uma vez sem contrato do destinatário.

| Estado | Significado |
| --- | --- |
| `pending` | Entrega nova aguardando reserva. |
| `inflight` | Token/lease reservados por uma tentativa. |
| `retry` | Rede, timeout,429 ou5xx reagendado com prazo. |
| `delivered` | Resposta2xx confirmada com token/lease atuais. |
| `failed` | Resposta definitiva ou máximo de cinco tentativas alcançado. |
| `cancelled` | Condições de autorização/funcionalidade deixaram de permitir a entrega. |
| `no_destination` | Destino ausente; terminal explícito, sem simular envio bem-sucedido. |

Backoff normal:5,10,20,40s, com no máximo cinco tentativas. Somente429/503 aceitam `Retry-After` válido e limitado a300s; outras respostas não alteram o atraso por esse header. Token vencido ou da sessão anterior retorna `stale`, resultado do helper e não um oitavo estado persistido. Perda do backend aborta HTTP e impede confirmação por reconexão. A liberação da barreira precisa ser confirmada; em falha ou lock residual, o cliente inteiro é destruído antes de reutilização.

## Pausa, retomada e origem

Pausa global/local aguarda a tentativa HTTP já iniciada e cancela definitivamente pendências inelegíveis na mesma transição do banco. Retomar não ressuscita os alertas antigos, inclusive timestamps futuros permitidos. Witnesses conservam cláusulas ANY/ALL originalmente válidas e suas gerações; uma alternativa habilitada somente depois não substitui a autorização original. A elegibilidade atual também é revalidada antes do envio.

Mudanças de dispositivo, regra, comunicação e associação são revalidadas, mas não têm a mesma serialização da barreira de pausa durante HTTP. Não se promete cancelar um efeito externo já recebido. As confirmações de escrita verificam alterações/recusas imediatas de triggers BEFORE/AFTER; triggers administrativas diferidas ao commit não fazem parte da garantia testada.

## Implantação e rollback

1. Conferir fonte, checksum do ledger, backups restaurados e quatro credenciais. Não aplicar038 isoladamente sobre uma release com produtores antigos ainda enviando diretamente.
2. Interromper todos os produtores antigos e o worker anterior. `setup-prod.sh` confirma que os contêineres `ingest`/`notifications` pararam antes das migrations. Isso não comprova drenagem MQTT nem a inexistência de produtores externos; validar sessão persistente, QoS e entregas em trânsito no broker real antes do rollout.
3. Aplicar a migration pelo ledger, provisionar quatro roles e iniciar produtores novos e worker compatível. Seed é exclusivo de demonstração descartável. Conferir saúde, estados e uma entrega sintética autorizada para um destino de ensaio.
4. Para rollback, parar primeiro o worker novo. Eventos persistidos precisam de decisão explícita sobre continuidade/cancelamento e deduplicação no destino. Não ativar envio direto e outbox simultaneamente nem fazer replay cego ou editar tokens/leases manualmente.

Este procedimento ainda requer ensaio completo de atualização/rollback com broker real. Ingestão continua usando conexão proprietária enquanto suas outras responsabilidades não forem separadas;038 não encerra a etapa de privilégio mínimo de todos os serviços.

## Inspeção e recuperação

Somente um operador autorizado com a conexão de manutenção pode inspecionar a fila privada. Um agregado de estados é preferível a exportar mensagens/identidades:

```sql
SELECT status, count(*) AS quantidade, min(created_at) AS mais_antiga
FROM public.event_deliveries
GROUP BY status
ORDER BY status;
```

Não usar o DSN do worker para contornar ACLs. Não publicar mensagens, fixtures, dumps ou logs privados. `failed`/`no_destination` são terminais; configurar um destino depois não reativa essas entregas automaticamente. Não há UI de operação/replay nem política automática de retenção/expurgo neste incremento; definir esses próximos passos antes de aceitar crescimento indefinido das tabelas.

O [guia de backup](BACKUP_E_RESTAURACAO.md) distingue preparação do banco/roles novos de restauração dos objetos pelo archive. Não transportar credenciais globais por `pg_dumpall`. O ensaio mantém os sete estados, witnesses, evento/chave, ACLs/RLS/owners e ledger38; aguarda a lease real, rejeita token antigo e recupera o trabalho usando novo backend.

## Provas e operação pendente

- SQL038:54 testes reais, incluindo ACLs, leases, gerações, pausas, ANY/ALL e recusas/alterações imediatas por triggers; hash da migration conservado.
- Produtores: integral123/123,40 próprios e83 regressões; queda antes/depois do commit, OFFLINE atômico, SSE falho, tipos JSONB e reconfirmação da origem/outbox antes do commit/ACK.
- Backup:2/2 restaurações reais, incluindo outro cluster físico e reprovisionamento das quatro roles. O CI ganhou job separado com dois serviços de banco; a execução desse novo CI ainda está pendente.
- Worker: suíte real de SQL/HTTP/processo, incluindo dois workers, conexão perdida, liberação recusada, SIGKILL e espera real20s para recuperação com a mesma chave. Integral36/36 Linux, sem skips; a negativa do heartbeat herdado foi reproduzida e a correção passou no startup com o mesmo PID. Conferir logs/limites em `CONTINUIDADE.md`.
- Tipos dos15 workspaces, boundaries, imagem Node24, Compose, Caddy e contratos de rollout passaram no candidato. A integral API038 também passou697/697,0 skips, em25min02s; Playwright222/222 em três motores/0 retries, cliente64/UI89/mobile75 e bancoLinux34+2 skips de backup passaram. São provas locais; implantação pública, contrato de idempotência do destinatário e novo CI ainda precisam de confirmação.

Scripts usam bancos/clusters descartáveis explicitamente autorizados. As suítes que endurecem roles ou trocam senhas são isoladas das credenciais da API/navegador. Skips por falta de ambiente não representam teste executado. Evidências brutas/segredos permanecem fora do Git; o checkpoint contém somente fontes recuperáveis, com restauração/hash verificados.
