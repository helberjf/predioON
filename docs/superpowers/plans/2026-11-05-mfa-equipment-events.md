# MFA: equipamentos e coordenação do SSE

**Atualização:** device-status passou nos nove testes dirigidos e nas sete regressões separadas (71 casos). [Prova](../../evidencias/mfa-device-events-2026-11-05.json). Depois, os [25 testes originais de equipamentos passaram](../../evidencias/mfa-equipment-original25-2026-11-05.json), com MFA real nas duas fixtures administrativas e produto idêntico. Os dois envelopes propostos estão no candidato, com ACL15, rechecagem final e ANY sem freshness preservados. O desenho inicial abaixo fica como histórico; gateway e heartbeat continuam pendentes. Não houve ativação no runtime da main.

Registro do desenho inicial de 05/11/2026: na ocasião era **análise estática,
sem autoria ou execução**. Fonte consultada: composição preparada original17
`52b2c494…`, com produto idêntico a `77b1c351…`. As provas de alertas, telemetria
e suas fixtures permanecem separadas. Este desenho não autoriza aplicar068 à
instalação publicada067, nem afirma cobertura global de MFA.

## Prioridade: device-status antes de gateway e heartbeat

`apps/api/src/modules/events/equipment.ts:11–24` lê o dispositivo sob RLS,
consulta classificação por helper SD, lê funcionalidades e faz uma verificação
nova de capacidade. A SQL candidata já acrescenta MFA à RLS de devices/gateways;
portanto, não é correto afirmar que a leitura inicial está toda desprotegida.
O próximo recorte deve fechar os pontos posteriores de classificação/autoridade
e preservar seu contrato temporal, sem copiar mecanicamente telemetria/alertas.

Há dois oráculos concretos que limitam a implementação:

- `equipment-events-capabilities.test.ts:342–361` exige reavaliar a autoridade
  em um novo statement quando o suporte expira depois da classificação e antes
  da entrega. Um único snapshot com remoção dessa verificação quebra o contrato.
- Linhas218–225 usam **ANY das funcionalidades, sem freshness**. Um estado atual
  de equipamento pode ser entregue após retomada mesmo sem nova observação.
  Não aplicar `observationIsCurrent` nem exigir instante posterior a resumedAt.

## Recorte de dispositivo proposto para revisão

Manter dois pontos SQL estreitos, cada um protegido no próprio statement:

1. `app_mfa_device_event_context(text,text) RETURNS jsonb`, escalar STABLE,
   INVOKER e não STRICT. Primeiro executar `app_require_session_mfa()`. No mesmo
   snapshot, ler status persistido do par exato prédio/dispositivo sob RLS,
   delegar classificação ao helper existente
   `app_equipment_device_classification`, e obter apenas estados globais/locais
   necessários a `resolveFeatures`. Sem registro/classificação, retornar contexto
   vazio depois do guard. Não retornar metadata, credenciais, serial ou histórico.
2. Reutilizar as regras puras de tipo, gate e parking e o ANY de enabled. Não
   duplicar catálogo de funcionalidades em SQL. Preservar leitura do inventário
   desabilitado e o DTO de quatro campos com status persistido, ignorando o status
   recebido na notificação. Os horários de retomada não filtram esse evento.
3. Preservar a verificação final em statement novo, agora por um escalar estreito
   como `app_mfa_device_event_allowed(text,text) RETURNS boolean`: guard MFA antes
   de `app_device_has_capability(...,'devices:read')`. Sem capacidade, retornar
   false/null conforme o contrato; PMF01/PMF02 continuam erros explícitos. Não
   conceder uma capacidade diferente ou usar `app.role` como autoridade.
   Para um registro/classificação válidos, conservar a ordem original: executar
   essa verificação antes de decidir o filtro de funcionalidades, sem antecipar
   um retorno por feature desativada que a pulasse.
4. Manter o lock existente de funcionalidades. Ambos os pontos SQL têm guard e
   autorização coerentes com sua própria observação; o segundo acrescenta a
   atualização de autoridade já exigida pelo comportamento anterior. Ele não
   substitui a proteção do primeiro nem serve de justificativa pre/post falsa.
5. Fixar owner/search_path, qualificar referências e normalizar a ACL app-only
   para as duas novas assinaturas. Não mudar helpers RBAC puros, suas permissões,
   serviços sem SID, políticas permissivas nem grants de tabela.

São nomes de desenho, não funções já disponíveis. A lista de assinaturas passaria
de13 para15 somente após a implementação revisada. Paths prováveis: SQL candidata
068, `modules/events/equipment.ts` e um teste dirigido novo. Um pequeno adaptador
puro de funcionalidades pode ser compartilhado explicitamente; não alterar todos
os domínios para facilitar esse recorte.

## Provas necessárias

- Frame positivo real de device-status reconstruído do banco apesar de status
  forjado. Em uma barreira teste-only após o primeiro contexto/classificação e
  antes da verificação final, ativar binding ADMIN preexistente. Comparar anterior
  e corrigida, decodificando qualquer frame anterior antes da assertiva negativa.
- No SQL, PMF01/PMF02 e SID ausente/estrangeiro/malformado antes de entradas nulas,
  inexistentes, divergentes ou sem capacidade, para os dois pontos novos.
- Prova satisfeita conserva acesso local e não concede outro dispositivo; suporte
  devices-only não ganha telemetria/alertas. Capacidade expirada ou revogada entre
  os dois pontos não entrega status; manter a regressão temporal já existente.
- Tipo misto com ANY, pausa/retomada sem freshness, equipamento desabilitado,
  classificação de gate/parking apenas no prédio real, IDs TEXT estranhos e
  exclusão de campos privados. Nenhum SELECT posterior pode depender de novo
  acesso não guardado para compor o DTO.
- ACL/owner/search_path/STABLE/INVOKER/não STRICT e identidades efetivas dos seis
  papéis, além das regressões MFA já aceitas, em execuções separadas.

O arquivo original de equipamentos contém25 casos, incluindo dois controles de
prazo/observação e os contratos de escopo, equipes, suporte, pais ativos,
classificação, funcionalidades, marcadores, revogação e planos limitados. Repetir
esse arquivo com preparação MFA legítima dos administradores onde necessário;
não retirar assertivas, aumentar prazos ou criar skips. Testes novos devem usar
barreiras sem sleeps; a regressão original de expiração deve permanecer válida.

## Gateway-status como etapa posterior pequena

O projector de gateway faz atualmente uma única leitura de status sob RLS e
entrega quatro campos. Um envelope escalar guard-first da leitura exata pode
padronizar decisões vazias/nulas sem acrescentar funcionalidades/freshness que
o evento nunca exigiu. Preservar inventário desabilitado, escopo de gateway
independente de dispositivo e status persistido. Avaliar em lote próprio depois
do dispositivo, sem declarar uma vulnerabilidade adicional não reproduzida.

## Heartbeat e headers: etapa própria, sem falsa promessa SQL

`modules/events/routes.ts:81–88` já resolve a identidade e aplica o gate MFA
antes do comentário `: ping`. A tarefa é disparada por intervalo de25 segundos
fora da cadeia `delivery` que serializa eventos. Não há leitura privada de
domínio no comentário; outro pre/post SELECT em pool diferente não lhe daria
atomicidade global nem resolveria as projeções pendentes.

O heartbeat também reatribui `req.auth` independentemente do trabalho do evento.
Revisar esse uso compartilhado ao coordenar as tarefas, lembrando que
`inTenantContext` captura a identidade em constantes antes de aguardar o banco.
A sobreposição de agendamento é observação estática; não é demonstração de
troca de usuário, bypass MFA ou vazamento. A conferência do gate antes dos
headers também precisa respeitar o limite entre observação no banco e rede.

Depois dos equipamentos, ensaiar uma mudança curta de coordenação: serializar
a tarefa de heartbeat com o trabalho da mesma conexão, verificar identidade
atual antes de escrever e impedir ping/frames após falha ou fechamento. Preservar
intervalo25s, expiração, limite de fila100, token curto, regras do query-token
exclusivo e o fim de conexão. Não reabrir a autenticação de todos os endpoints.

Testes devem capturar/controlar somente o agendamento no harness, sem reduzir
o intervalo de produção ou esperar25s repetidamente: conexão comum recebe ping,
promoção sem prova/revogação fecha sem novo ping, callback em voo não escreve
após close, eventos e heartbeat têm ordem/limite determinísticos e o cleanup
remove os próprios timers/listeners. O mecanismo concreto de relógio/barreira
exige revisão antes de execução; nenhum desses testes existe por este desenho.

## Limites preservados

Não prometer linearização com promoção confirmada depois do último snapshot e
antes da rede. Outros callers dos helpers SD, mutações/no-match, funções VOLATILE,
expiração após locks, defaults ACL/triggers adversariais e integração completa
continuam pendentes. Provas sintéticas de sessão não aprovam TOTP, navegador,
Android/iOS, operação ou produção. Restaurar fonte não instala dependências,
inicia serviços, aplica migrations ou executa testes; manter guards e a proibição
de reiniciar computador, Docker ou WSL nesta sessão.
