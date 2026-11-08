# Revisão independente do preparador e executores de revogação

Revisão estática em 07/11/2026. Nenhum bloqueador concreto identificado. Nenhum executor, Node, typecheck, teste, banco ou serviço foi executado pelo revisor; os arquivos dos autores não foram alterados.

`executors-handoff.json`: SHA256 `025a5680d876622d6b5fccff8933a64415e997e42cc664836ff05e76e73a5f53`. `controllers.patch`: `f4325871b2d141979d0d356f133e7f2a59aed247dead835353c0f2514dc9e800`. Ambos em `work/mfa-tenancy-revocation-harness-20261107`.

## Fonte e composição

Prepared baseline `2457485be50acdc4fe2a13e6f42a0a0b03171da5839b31cc80804abd6af1b1a2` e fixed `c2bb641f60ff44d847f4b34cf472cddcf235e0897c93659767eab514816a3c25` conferidos por hash. Config de tipos `c5aae089d1f7c4e26c7104830926fa396258c4d46d1fb69fe5bb5736460feeab`. A composição preserva o parent 36e5/1.033, acrescenta o mesmo teste aos dois lados e só altera tenancy no fixed: 1.034 arquivos, 30 arquivos de testes para tipos e 13 fontes exigidas na resolução.

O preparador verifica fontes, manifests e destinos antes da escrita, exige diretório novo, copia somente inventário de fonte e mantém 23 junctions de workspace apontando para a composição local e 134 dependências externas. Não copia builds, caches ou dotenv. Nenhum cache é excluído novamente; sete pertencem ao histórico V4. A resolução usa exports de source dos pacotes, não dist antigo.

## Execução e isolamento

- O launcher exige autorização root e fonte canônica 53c4, permitindo diferenças de documentação no HEAD observado. Confere 994 arquivos originais, composição congelada, checks de tipos/resolução e ausência de dotenv antes do processo de aplicação.
- Exige cluster exclusivo já ativo e atestado por ID, system identifier, loopback5468, limites de CPU/memória e zero reinícios. Nenhum comando start/restart é acrescentado. Guard de memória: 1.536 MiB antes da fase e de cada filho.
- Catálogo inicial precisa estar vazio de tabelas públicas, bases temporárias/estranhas e outros clientes; seis roles conhecidas. Credenciais e settings completos são comparados em memória e não publicados.
- A fixture oficial cria somente banco UUID, aplica ledger68, verifica controle owner e provisiona credenciais temporárias. Testes rodam nas conexões restritas previstas. Segredos do ambiente e URLs são limitados/sanitizados nos registros.
- Apenas PIDs filhos registrados podem receber encerramento de árvore por timeout. Se um filho direto não teve exit observado, o controlador retém a limpeza para inspeção root. A fixture não usa DROP DATABASE FORCE. Postchecks exigem base removida, zero clientes, roles/settings restaurados e atestado conservado.
- Evidência anterior impede nova execução no launcher: qualquer log/evento, controller-start, owned-database, resultado ou postcheck. Logs e resultado do controlador também usam escrita exclusiva; uma tentativa não deve sobrescrever a anterior.

## Classificação necessária

Os controllers preservam exit1 do teste para inspeção posterior e finalizam como `completed-awaiting-TAP-GREEN-classification`; esse estado e exit0 do controlador não significam teste aprovado. O verificador posterior precisa conferir nomes, status e diagnósticos, aceitar baseline apenas com nove controles aprovados e doze diferenças esperadas, exigir fixed21/0 e regressões92/0, sem skips/cancelamentos. Não aceitar erro500, timeout, preparação ou falha anterior à barreira como RED.

As sete regressões configuradas e os hashes coincidem com PLAN.json: links12, structure12, people9, tenancy-http9, tenancy-edit11, membership-lifecycle4 e comandos35. Total92 TAP, incluindo dez grupos agregadores:82 casos independentes. São separadas dos21 dirigidos; ainda são seleção e expectativas, não resultado desta revisão.

## Pins dos executores conferidos

- `mfa-tenancy-revocation-baseline-qa-20261107/run-mfa-directed.mjs` — `1b00a7b94696988547eed93aa04b863e704ba3a954643d23a48b8c2742d51548`.
- `mfa-tenancy-revocation-baseline-qa-20261107/launch-mfa-directed.ps1` — `324d22156ae65b6fc4daf18995d429527e3930e4150f830be004b29ccd990d80`.
- `mfa-tenancy-revocation-fixed-qa-20261107/run-mfa-directed.mjs` — `c34ef99c9f4ef349b1d0b947dba390e0dd12cd2b1796e1328f675142f2edd870`.
- `mfa-tenancy-revocation-fixed-qa-20261107/launch-mfa-directed.ps1` — `8324e6398483d61f0be019dad87dd62a6bbb35b4b4cbbb1cc3dde665078b79c4`.
- `mfa-tenancy-revocation-fixed-regression-qa-20261107/run-mfa-directed.mjs` — `9f7988e1e745b4c640a57ed4703f775d3ce170c016310d06cabfd689f39abd30`.
- `mfa-tenancy-revocation-fixed-regression-qa-20261107/launch-mfa-directed.ps1` — `f266686f60c9ce647d1d4f4560475c80aa9bdcce0c503b32008a05048958ea61`.

A revisão cobre autoria e contratos observáveis desses arquivos. Não atesta comportamento de encerramento em toda falha possível, performance, produção ou conclusão do plano maior.
