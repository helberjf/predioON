# Inbox dos gateways: o que foi decidido em 07/10/2026

Este arquivo existe para você revisar com calma. Em 07/10 você autorizou que as decisões pendentes da inbox fossem tomadas sem a sua homologação prévia, desde que ficassem documentadas. Tudo aqui pode ser revertido; a última seção diz como.

O desenho completo e original continua em [superpowers/plans/2026-10-03-durable-inbox.md](superpowers/plans/2026-10-03-durable-inbox.md). Ele não foi apagado nem implementado por inteiro.

## Resumo em uma tela

| Assunto | Decisão tomada | Onde pensar de novo |
|---|---|---|
| Fila separada com worker próprio | **Adiada.** As garantias foram postas no caminho que já existe | Seção 1 |
| Leituras "retained" do broker | Guardadas como histórico, sem contato, consumo, vagas nem alerta | Seção 2 |
| Alerta sobre leitura antiga | Regra só dispara para leitura de até **5 minutos** | Seção 3 |
| Mesmo `eventId` em dois condomínios | Passa a valer por condomínio e dispositivo | Seção 4 |
| Mesmo evento com conteúdo diferente | Vale o primeiro; o segundo é contado e descartado | Seção 4 |
| Por quanto tempo lembrar eventos já vistos | **Sem prazo.** Nada é apagado automaticamente | Seção 5 |
| Reinício do broker | A configuração de produção perdia leituras; corrigida | Seção 6 |

## 1. A decisão maior: não construir a fila separada agora

**O que o desenho original pedia:** receber a leitura, gravar um recibo, confirmar ao broker e deixar um segundo processo (worker) aplicar os efeitos depois. Isso traz duas roles novas de banco, reserva com prazo e token, ordem por dispositivo, cotas, retentativas e limpeza. São cerca de dez conceitos novos e oito famílias de ensaio com queda de processo.

**O que o código já fazia:** a ingestão só confirma a leitura ao broker (PUBACK) **depois** de gravar tudo numa única transação. Se o processo cai no meio, a transação é desfeita e o broker entrega de novo. Ou seja, a promessa central da inbox, "trabalho obrigatório sobrevive à queda do processo", já vale para leituras QoS 1.

**Por isso a decisão foi:** manter esse caminho e corrigir nele os defeitos reais que o desenho apontava (seções 2 a 6). Nenhum conceito novo de operação entra no sistema.

**O que se perde com isso, honestamente:**

- **Absorver rajadas.** Com a fila, o broker é liberado rápido e o trabalho pesado espera. Sem ela, se o banco ficar lento, as leituras se acumulam **no broker**, não no nosso banco. Com a sessão durável da seção 6 elas não se perdem, mas ficam invisíveis para nós enquanto esperam.
- **Isolar uma leitura problemática.** Hoje as leituras são processadas uma por vez. Uma leitura que sempre falha por erro de banco trava as seguintes até o erro passar. Leitura inválida não causa isso: ela é recusada e contada.
- **Menor privilégio.** A ingestão continua usando a conexão dona do banco. O desenho original a trocava por duas roles restritas.
- **Escalar para vários consumidores.** Continua sendo um processo só.

**Quando vale reabrir essa decisão:**

1. A ingestão passar a ficar atrasada com frequência (leituras chegando ao painel com minutos de atraso sem o gateway estar offline).
2. O número de dispositivos crescer a ponto de um único processo não dar conta. Não há medição de capacidade ainda; ela precisa ser feita antes de um condomínio grande.
3. Você quiser tirar da ingestão a conexão dona do banco por exigência de segurança ou auditoria.
4. Entrar um contrato de firmware com identidade atestada do gateway, que o desenho original já previa.

Se qualquer um desses acontecer, o desenho original está pronto para ser retomado; o que foi feito agora (seções 2 a 5) é pré-requisito dele e não precisa ser refeito.

## 2. Leituras "retained"

**O que é:** o broker pode guardar a última mensagem de um tópico e reenviá-la a cada vez que alguém assina. Quando a ingestão reinicia, ela recebe de novo uma leitura que pode ter horas ou dias.

**Antes:** essa leitura era tratada como nova. O dispositivo aparecia como online, e um valor fora do limite gerava alerta.

**Decisão:** leitura retained entra no histórico uma única vez e mais nada. Não marca dispositivo nem gateway como online, não entra em consumo, não muda vaga de estacionamento, não gera alerta e não atualiza o painel ao vivo. A mensagem nunca é apagada do broker por nós.

**Por quê:** o broker repetir o que tinha guardado não prova que o sensor está vivo agora.

**Pense de novo se:** algum equipamento seu publicar de propósito com retained para informar o estado atual (alguns sensores de porta e vazamento fazem isso). Nesse caso a regra certa para aquele tipo seria aceitar o estado, e não só o histórico. Não conferi isso contra um firmware real; vale checar quando o gateway estiver definido.

## 3. Alerta só para leitura recente (5 minutos)

**Antes:** um gateway que ficasse horas offline e depois descarregasse o que tinha guardado disparava de uma vez todos os alertas daquele período, com data antiga.

**Decisão:** uma regra de alerta só é avaliada se a leitura tiver no máximo **300 segundos**. Leitura mais antiga é gravada no histórico e nos gráficos normalmente, mas não vira alerta. É o mesmo prazo que os alertas de consumo já usavam.

**O que isso muda na prática:** se um vazamento aconteceu enquanto o gateway estava offline e a leitura chegar seis minutos depois, **não haverá alerta por regra para aquela leitura**. O alerta de gateway/dispositivo offline continua existindo e é ele que avisa nesse intervalo. Quando a próxima leitura ao vivo chegar ainda fora do limite, o alerta dispara.

**Pense de novo se:** você preferir ser avisado de um incidente passado mesmo com atraso. As alternativas são aumentar o prazo (por exemplo 15 ou 30 minutos) ou criar um alerta de tipo diferente, "ocorreu enquanto offline", que não se confunda com um incidente em curso. O valor está em `RULE_FRESHNESS_MS`, em `services/ingest/src/rules/evaluate.ts`.

## 4. Identidade do evento e conflito de conteúdo

**Antes:** o `eventId` era único no sistema inteiro. Se dois condomínios (ou dois dispositivos) usassem o mesmo identificador, a leitura do segundo era descartada em silêncio.

**Decisão:** um evento é identificado por **condomínio + dispositivo + eventId**. A migration 048 troca a chave da tabela `ingest_events`. Além disso, cada evento aceito guarda uma impressão digital (SHA-256) do conteúdo:

- mesma identidade e mesmo conteúdo: é reentrega, aplicada uma vez só;
- mesma identidade e conteúdo diferente: **vale o primeiro**; o segundo não produz efeito e é contado como `CONTENT_CONFLICT`;
- evento gravado antes da 048 (sem impressão digital): continua bloqueando a própria identidade, mas não dá para comparar conteúdo. Nenhuma impressão digital é inventada para o passado.

O sensor de água identifica a leitura pelo horário. Portanto duas leituras do mesmo sensor no mesmo instante com valores diferentes são conflito, e vale a primeira.

**Pense de novo se:** um firmware precisar corrigir uma leitura já enviada. Hoje a correção seria ignorada. O caminho certo seria o firmware mandar um `eventId` novo.

## 5. Por quanto tempo lembrar eventos já vistos

**Decisão:** sem prazo. A tabela `ingest_events` não é limpa automaticamente, e não há idade máxima para aceitar uma leitura histórica.

**Por quê:** as duas coisas andam juntas. Se a memória de eventos vistos expirasse em, digamos, 90 dias, e o sistema continuasse aceitando leituras de 91 dias atrás, a mesma leitura poderia ser contada duas vezes. Para apagar com segurança é preciso primeiro definir "não aceito leitura mais antiga que X", e isso depende de quanto tempo o gateway real guarda dados offline, o que só se sabe com o firmware em mãos.

**Custo:** uma linha pequena por leitura, para sempre. Com 100 sensores a uma leitura por minuto são cerca de 52 milhões de linhas por ano. É administrável por alguns anos, mas não é infinito.

**Pense de novo quando:** o firmware do gateway estiver definido. Aí dá para fixar a janela (por exemplo, 30 dias de buffer offline) e apagar o que for mais antigo.

## 6. Reinício do broker (EMQX)

Foi feito um ensaio com a imagem real de produção (EMQX 6.3.1) em contêiner descartável: publicar uma leitura QoS 1 com a ingestão desconectada, reiniciar o broker e reconectar.

| Configuração | Sobrevive à ingestão offline | Sobrevive ao reinício do broker |
|---|---|---|
| Produção como estava | sim | **não: leitura e assinatura perdidas** |
| Com `EMQX_DURABLE_SESSIONS__ENABLE=true` | sim | sim |

**Decisão:** a variável foi acrescentada ao `infrastructure/docker-compose.prod.yml`. Sem ela, a sessão vivia só na memória do broker, e o volume de dados não ajudava.

**Atenção ao aplicar numa instalação já em uso:** a troca vale para sessões novas. Na primeira subida com a variável, o que estava pendente na sessão antiga em memória se perde, como já se perderia em qualquer reinício. Faça a troca num momento sem acúmulo.

O ensaio pode ser repetido com `node services/ingest/scripts/broker-session-rehearsal.mjs <url> <contêiner>`, sempre contra um broker descartável, porque o script o reinicia.

**O que o ensaio não cobre:** leituras QoS 0 (não têm garantia nenhuma, por definição do protocolo), autenticação e TLS da produção, e o comportamento com disco cheio.

## 7. Como ver o que foi recusado

A tabela `ingest_rejections` guarda contadores por dia e categoria. Não guarda o conteúdo recusado, nem tópico, nem identificador de dispositivo ou evento. Só o dono do banco lê; ainda não há tela.

```sql
select day, building_id, category, total, last_at
from ingest_rejections order by day desc, total desc;
```

| Categoria | Significado |
|---|---|
| `INVALID_ENVELOPE` | JSON quebrado, campo fora do contrato ou tópico que não bate com o conteúdo |
| `FUTURE_TIMESTAMP` | Horário mais de 60 s à frente do servidor (relógio do gateway errado) |
| `UNKNOWN_SOURCE` | Dispositivo inexistente ou desativado, condomínio inativo ou gateway desativado |
| `CONTENT_CONFLICT` | Mesma identidade com conteúdo diferente (seção 4) |
| `RETAINED_REPLAY` | Leitura retained guardada só como histórico (seção 2) |

Um número alto e crescente de `FUTURE_TIMESTAMP` ou `CONTENT_CONFLICT` num condomínio indica problema no gateway daquele prédio.

## 8. O que ficou de fora

- Fila, worker, roles restritas, cotas e retentativas do desenho original (seção 1).
- Status do gateway e confirmação de comando de portão: continuam como estavam, sem deduplicação.
- Contato (heartbeat) em reentrega: uma reentrega do mesmo evento ainda marca o dispositivo como visto. O desenho original propunha não marcar.
- Preservar a memória de eventos quando um dispositivo é excluído: hoje ela é apagada junto. Excluir e recriar um dispositivo com o mesmo identificador permitiria recontar um evento antigo.
- Tela ou API para os contadores da seção 7.

## 9. Como desfazer

| Para desfazer | Faça |
|---|---|
| Prazo de 5 minutos das regras | Alterar `RULE_FRESHNESS_MS` (um valor muito alto equivale a desligar) |
| Tratamento de retained | Remover o desvio `if (retained)` em `services/ingest/src/pipeline/telemetry.ts` |
| Sessão durável do broker | Remover a variável do compose de produção |
| Chave por condomínio/dispositivo | **Não desfazer** sem antes conferir que não há dois eventos com o mesmo `eventId`; voltar à chave global falharia se houver |
