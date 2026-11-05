# Coordenação do heartbeat SSE — proposta para revisão

**Resultado em 05/11:** nove testes dirigidos e 105 regressões passaram na composição candidata. [Prova e limites](../../evidencias/mfa-heartbeat-2026-11-05.json). Apenas routes.ts mudou no produto. Os controles de expiração automática e quantidade exata de res.end continuam fora da prova; integração web/nativa e rollout não foram aprovados. O desenho original abaixo fica como histórico.


Estado: análise estática; nenhum teste, compilador, banco ou código de produto executado/alterado nesta tarefa. Fonte candidata: prepared7b53ab4e47a4bf7f2fc480d2ce2f9f6a013c206da10367a895bab35c2894dbfb, 1016 arquivos, raiz994,23 junctions. `apps/api/src/modules/events/routes.ts` SHA7d79f6233982db76e13f001761bcf36223da02a6198ea60d815aa075c8d81551.

## Achado e limite da conclusão

- `routes.ts:39–77`: cada notificação entra na mesma Promise `delivery`; limite100 inclui trabalho em execução. A identidade é lida novamente em46, antes do contexto transacional. A escrita ocorre depois da transação e verifica closed/writableEnded.
- `routes.ts:81–88`: o timer25_000 chama resolveIdentity diretamente, fora dessa fila. Já verifica identidade, MFA e closed/writableEnded; não é ausência de gate. A atribuição req.auth em85 pode ocorrer enquanto um evento está em processamento. Ticks sucessivos também podem sobrepor consultas de identidade se uma consulta durar mais de25s.
- `auth/service.ts:40–71`: resolveIdentity inicia buildIdentity, que chama identityDb.select sincronicamente antes do primeiro await; resultado real reúne conta/família/requisito/links. Isso oferece observação determinística de início da consulta sem mock de identidade.
- `auth/middleware.ts:94–99`: inTenantContext captura auth antes de abrir withUserContext. Logo uma atribuição posterior não prova alteração dos GUCs já capturados. Não alegar vazamento privado causado pelo heartbeat ou segurança linearizável.
- `routes.ts:90–97`: expiry fecha independentemente da fila; close limpa timers e unsubscribe. Devem continuar independentes de uma consulta lenta.

## Recorte de produto proposto (ainda não autorado)

Um único arquivo de produto, routes.ts; um novo teste dedicado. Sem SQL, contratos, projectors ou helper global alterado.

1. Acrescentar enqueue interno por conexão para serializar trabalhos de evento e heartbeat na mesma cadeia. Eventos conservam contador e teto100, incluindo o evento ativo; decremento em finally. Não usar fila global.
2. Timer apenas solicita heartbeat. Flag heartbeatPending cobre tanto espera como execução; ticks adicionais coalescem enquanto a flag estiver ativa. Um heartbeat não consome slot dos100 eventos: máximo100 eventos mais um trabalho de heartbeat por conexão. A flag volta a false em finally.
3. Trabalho de heartbeat verifica conexão aberta antes da consulta; resolveIdentity e assertOperationalMfa reais; verifica novamente abertura após await e imediatamente antes de escrever `: ping\n\n`. Não precisa atribuir req.auth: a identidade local serve ao ping. Trabalho de evento também só atribui req.auth após identidade válida e rechecagem de abertura.
4. Falha de qualquer trabalho fecha a mesma conexão, sem frame de erro e sem retry. Uma rotina local idempotente de fechamento marca closed imediatamente, limpa timers e unsubscribe, e chama end somente se necessário; close/abort/expiry/overflow convergem nela. Referências de cleanup devem ser inicializadas de modo seguro (sem TDZ se fechamento antecipado ocorrer). Não esperar a fila para expiry/overflow/desconexão.
5. Preservar token header/query, verificação inicial, expiração calculada de JWT, retry5000,25_000, DTOs e ordem dos eventos. Preservar checks pós-commit e não emitir após writableEnded. Não prometer cancelar consulta SQL já em execução; ela precisa terminar/rollback e os callbacks restantes não podem escrever nem começar nova autorização.

Tradeoff explícito: ping aguarda evento anterior; uma transação lenta pode atrasar keepalive e a revalidação pelo heartbeat. A expiração do token continua imediata via timer independente, e os guards SQL de evento continuam responsáveis por sua própria autorização. Esta mudança não resolve corrida entre um último SELECT autorizado e uma revogação posterior, nem backpressure de res.write(false).

## Instrumentação local de teste, sem hook de produto

Basear fixture no novo platform-mfa-device-events.test.ts: HTTP real, login de leitor comum, token/SID reais, LISTEN/NOTIFY real, SQL owner apenas arranjo e promoção de bindingADMIN preexistente inativo. Usar actors próprios por caso para não herdar promoção/revogação.

- Suite concurrency:false/processo único. Capturar globalThis.setInterval somente durante abertura da conexão-alvo e somente delay===25_000; delegar todo resto. Para esse handle usar timer real de callback inerte e guardar o callback original para disparo manual. clearInterval real continua funcionando; observar cancelamento desse handle. Restaurar globals em finally. Nenhum avanço global de Date, nenhum sleep25s, nenhuma mudança de timeout de produto. Não interceptar indiscriminadamente timers de pools/HTTP.
- Wrapper local de identityDb.select apenas incrementa contador/timeline e delega com receiver correto; nenhum resultado fabricado. Instalar depois do login/stream inicial. O wrapper permite verificar imediatamente após disparar tick se uma consulta de identidade começou durante a barreira. A baseline atual chama select antes de o callback retornar; a implementação enfileirada não inicia até liberar o evento. Portanto esse RED não depende de esperar que algo NÃO aconteça por uma janela de tempo.
- Reutilizar o padrão Proxy de appDb.transaction no teste device: executar query real `app_mfa_device_event_context`, guardar rows, sinalizar reached e aguardar release; depois devolver as mesmas rows e deixar `app_mfa_device_event_allowed` real executar. `finished` só sinaliza após a Promise transacional terminar. Bounds5s para handshake/cleanup, como teste existente; não ampliar critérios para fazer passar.
- Servidor HTTP de teste pode observar res.write/res.end somente na resposta `/events/stream` alvo, delegando bytes/this exatamente e registrando linha do tempo. Não mockar resposta nem sucesso da aplicação. Leitura HTTP deve confirmar retry/frame/ping reais; observador detecta tentativa de escrita após close que o cliente desconectado não poderia observar.
- Para limite de fila, envolver appSqlClient.listen antes de startRealtimeBus: delegar registro real e observar callback de NOTIFY após callback original retornar. Publicar notificações em statements separados (PostgreSQL coalesce payload idêntico na mesma transação); aguardar marcador de cada callback. Isso prova contagem de admissões sem sleeps nem chamar diretamente uma função de produto. Restaurar wrapper depois de iniciar o bus; listener observado pertence ao processo isolado e é encerrado no cleanup.
- Toda barreira sempre liberada em finally; cancelar reader, aguardar término da transação, fechar servidor próprio e pools. Falha de cleanup não pode ocultar a primeira assertiva. Timer tardio disparado deliberadamente após close não deve iniciar consulta nova nem escrever.

## Oito casos propostos (expectativas, nenhum executado)

1. **RED de ordenação**: stream já entregou DTO positivo persistido; segundo evento está parado após contexto real. Disparar tick e afirmar imediatamente zero novas identityDb.select enquanto barreira ativa. Liberar e observar evento completo antes de ping, ambos reais. Baseline falha por início concorrente, não por exposição de DTO privado. Finally libera mesmo após falha.
2. **Coalescência**: repetir callback25k várias vezes durante a mesma barreira. Após liberação, exatamente uma autorização adicional e um ping; próximo tick após conclusão produz novo ping. Nenhum aumento do teto100. Baseline pode iniciar várias leituras; classificá-las pelo contador observado.
3. **Promoção ADMIN sem MFA**: leitor inicialmente operacional, evento bloqueado no contexto, tick solicitado, owner ativa binding e confirma autoridade; liberar. Guard final real fecha sem frame/ping posterior. Não inventar RED se baseline já fechar corretamente; este é controle de segurança da composição.
4. **Revogação em stream ocioso**: após ping positivo, owner revoga a família real; tick fecha sem novo ping/evento. Checar cleanup do handle e impedir leituras em tick tardio. Não confiar só em status200 já enviado.
5. **Ping normal e identidade restrita**: ping de leitor comum válido e de família verificada válida permanecem comentários exatos; mudar para prova MFA inválida/família válida fecha no próximo tick. Se usar prova sintética, declarar que não testa TOTP; reutilizar cerimônia HTTP somente se fixture já exigir.
6. **Close com evento em voo**: após barreira real e tick pendente, cliente aborta; aguardar close observado, liberar query. Zero writes após close, zero autorização do heartbeat enfileirado, transação termina e unsub/timer limpa. Não afirmar cancelamento da query em voo.
7. **Close/expiry com heartbeat em voo**: capturar SELECT real pelo builder delegado e pausar sua conclusão sem alterar rows; disparar callback de expiry capturado apenas para a conexão-alvo ou abortar conexão; ao liberar, nenhum ping/atribuição tardia. Expiry continua calculado pelo JWT; o teste dispara manualmente o callback identificado, não falsifica Date. Preferir abort como controle inicial e expiry como subcaso se captura inequívoca do handle for comprovada na autoria.
8. **Orçamento100 preservado**: primeiro evento bloqueado +99 notificações recebidas pelo callback real são admissíveis; ticks coalescidos não fecham essa conexão nem consomem slots. A101ª notificação fecha imediatamente sem aguardar barreira. Depois liberar e comprovar nenhum frame/consulta enfileirada após fechamento. Testar também unsubscribe para notificação posterior; não substituir isso por contador de publicações sem confirmação LISTEN.

A implementação do observador de builder no caso7 deve manter encadeamento/thenables reais; revisar tipos antes de executar. Alternativa menos intrusiva: barreira test-only na execução preparada do driver identity, mantendo SQL e resultado reais. Se não houver intercepção segura tipada, separar esse caso como pendência explícita, não usar identidade fake para alegar cobertura integrada.

## Harness e regressões

- Root executa somente após revisão do produto/teste e pins. Copiar composição7b53 por filelist, com source994 e23 junctions; baseline+teste versus fixed+routes+mesmo teste. Guards1536; preparo256/60s, resolve640/60s, types640/300s; teste384/300s, UUID novo oficial ledger68, owner somente fixture, seis roles restauradas. Sem start implícito nem alteração dos limites existentes.
- Tipos devem incluir novo teste e routes via imports; resolução tem de apontar ao source isolado, sem original. Primeiro RED/GREEN do novo arquivo; depois regressões em processos separados na composição final, incluindo device9 e os sete arquivos71 já existentes.
- A referência solicitada `events-limits8` não corresponde a arquivo encontrado. Existe `apps/api/test/reservation-limits-events.test.ts` com8 casos nas linhas64,82,97,107,114,145,173,211. É reserva/agenda/participação, não limite da filaSSE. Preservar e executar seus8 casos como regressão adjacente se esse era o nome abreviado, sem vendê-los como cobertura de heartbeat. Seus usuários são BUILDING_ADMIN/RESIDENT locais, sem PLATFORM_ADMIN, portanto não foi identificada necessidade de adaptar MFA nessa fixture.
- Não adaptar originalequipment25 silenciosamente; sua validação é outra rodada. Nenhum resultado futuro transferido de tipos/DB já passados em7b53.

## Critério para aceitar o recorte

RED de ordenação precisa mostrar consulta de heartbeat concorrente, seguido de GREEN com consulta e ping serializados, coalescência limitada, controles de fechamento/promoção/revogação reais e regressões preservadas. Reportar contagem TAP e cleanup observado; não ampliar a conclusão a todos os domínios, gateway ou proteção linearizável do último byte.
