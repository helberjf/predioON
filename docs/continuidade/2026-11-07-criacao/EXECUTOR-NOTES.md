# Controles API de criação: autoria e revisão estática

Os seis controles foram derivados dos executores de revogações já revisados. O autor não executou Node, banco, tipos, testes, launchers ou serviços. A preparação e as quatro fases de tipos foram executadas pelo root; seus arquivos foram apenas lidos e conferidos por este agente. Preparador, receitas, runner de tipos, configurações e fontes congeladas permaneceram intactos.

Pins reais usados:

- Baseline: `5c1cc7d59af253524f27b285d66f0b9b6d4059470035bb260573d333851e9b84`.
- Fixed: `ce90003f2777c890195c814b6560f0ca26edb2989f1770a2c4aabea8939d54ff`.
- Config de tipos: `f35970bbadf21805a103cecc05e9668ba8ca5b55ed0d715233a0ad5bc2d8f8ab`, 31 testes / 13 fontes obrigatórias.
- Modelo de controles: `mfa-tenancy-revocation-harness-20261107/executors-handoff.json`, SHA-256 `025a5680d876622d6b5fccff8933a64415e997e42cc664836ff05e76e73a5f53`.

As duas composições de 1.035 arquivos foram conferidas por hash e possuem somente uma diferença entre si: o router tenancy. O novo teste é idêntico em ambas. A regressão usa a própria fonte fixed e sua prova de tipos. Os três diretórios de execução são novos e cada controlador/launcher tem pin no `executors-handoff.json` deste diretório.

## Diferenças revisadas contra o modelo

Somente pins de preparação/config, contagem 1.034→1.035, seleção e rótulos de teste foram adaptados. Baseline/fixed selecionam o novo arquivo com 17 casos. Regressão mantém os sete anteriores e acrescenta os 21 casos de revogações, totalizando oito arquivos / 113 TAP. O caminho da regressão agora aponta para a fonte fixed de criação.

Antes do congelamento, a leitura estática identificou que a serialização de uma seleção unitária havia produzido um objeto JSON em vez de array. As duas declarações foram corrigidas para arrays antes de qualquer execução. Os bytes anteriores e o handoff preliminar estão preservados em `../mfa-tenancy-create-executor-authoring-review-20261107/`; não são controles utilizáveis nem evidência de falha de produto. As três listas finais foram lidas como JSON e suas contagens 1/1/8 e TAP 17/17/113 foram conferidas. Os diffs completos dos seis arquivos foram revisados após a correção.

## Contrato conservado

Executar somente após revisão do root, serialmente: baseline dirigido → fixed dirigido → regressão. O parâmetro `ExpectedHead` continua sendo o snapshot fonte `53c4c70dcd24f1045fad420fbce36757fd3753a2`; o HEAD corrente é capturado separadamente e só pode diferir em documentação. Não substituir esse parâmetro pelo commit corrente de documentação.

Cada launcher exige prepared/config exatos e os resultados nativos PASS de resolve/types correspondentes, sem timeout, com fonte/config/junctions estáveis e resolução isolada. Preserva o guard de 1.536 MiB, cluster previamente em execução com identidade/limites/loopback conferidos e fixture UUID oficial. A opção `StartOwnedCluster` continua sendo recusada. Não há comando novo de start/restart, parada de terceiros ou reinício do computador.

Continuam intactos: ambiente privado de credenciais fictícias, redaction, prazos, eventos, limite de logs, processos ocultos e encerramento somente da árvore possuída em falha. A limpeza da fixture fica retida se algum filho direto registrado não tiver saída observada, com PIDs e campos de inspeção preservados. Isso não é um censo universal de descendentes. O launcher recusa evidências anteriores e exige postchecks de banco vazio, seis roles/credenciais/settings restaurados e zero clientes remanescentes.

O status histórico `completed-awaiting-TAP-GREEN-classification` indica somente término dos processos e limpeza; não classifica o TAP como GREEN. O baseline precisa ser revisado explicitamente: 10 PASS / 7 FAIL, sete erros 201 versus 403, seis diagnósticos de capacidade e um de trigger com seus oráculos completos. O candidato deve ter 17 PASS; a regressão, 113 PASS em oito arquivos. A contagem isolada não aceita RED, e nenhum desses resultados de banco foi produzido pelo autor.

Datas UTC dos futuros logs/resultados devem ser preservadas, sem forçar 07/11 UTC. Nenhuma aceitação de navegador, Android, iOS, desempenho, concorrência universal ou produção decorre desta autoria.
