# Criação de usuários: resultado de MFA em 08/11/2026

**Aceite dirigido do candidato, sem aceite de produção.** Os 21 casos do mesmo teste V2 passaram após reproduzir dez divergências na baseline: seis respostas 201 e quatro 409 onde se exige 403. Passaram também 14 arquivos de regressão, com 213 entradas TAP, 203 casos independentes e dez grupos. A composição corrigida soma **234 TAP /224 casos independentes /dez grupos**, sem somar baseline ou tentativas históricas. Zero falhas, cancelamentos, skips ou TODO nos resultados corrigidos. [Prova auditada](../../evidencias/mfa-user-create-2026-11-08.json).

## Fontes e comportamento

O pai é o [candidato de convites/1.038 arquivos](../2026-11-08-convites/RESULTADO.md); o destino tem 1.039. Somente `POST /users` mudou, e um novo arquivo de teste foi acrescentado. O restante do router foi reconstruído por comparação de texto; outros arquivos, comandos de vínculos, schemas, helpers, ACL/policies e migrations permanecem iguais. O runtime da main conserva 001–067; a 068 continua candidata e não foi aplicada a uma instalação existente.

A consulta de e-mail duplicado usa `readMfaRows`, inclusive quando vazia. O INSERT consome a decisão MFA materializada na mesma instrução e valida seu resultado escalar; uma nova checagem após auditoria impede concluir os cenários testados com comprovação retirada. Mantêm-se a capacidade global `rbac:manage`, confirmação recente de senha, geração de ID, senha Argon2, sete campos públicos, defaults, nome/telefone, e-mail em minúsculas, criação de administrador e auditoria de plataforma. A alteração reutiliza o mapa de campos públicos e o decoder de datas existentes.

## O que foi exercitado

- Administradores pelo flag legado e por vínculo global, ambos com inscrição HTTP/TOTP real e mesma família de sessão. O owner não fabrica comprovação positiva.
- Retirada do fator ou da comprovação após a autorização global real, para e-mail novo e duplicado. As recusas corrigidas mantêm usuários e auditoria iguais à fotografia anterior; os quatro conflitos não constituem prova de escrita indevida.
- Criação comum/administrativa, DTO completo sem senha/token, hash que valida a senha fornecida, login HTTP da conta criada, estados MFA correspondentes e auditoria exata.
- Duplicidade sem distinção de maiúsculas, inclusive conta inativa; gestores locais e moradores sem capacidade global; autenticação e validação; confirmação recente de senha com recuperação real; capacidade global retirada após autorização.
- Dois triggers estreitos `AFTER INSERT`, em usuários e auditoria. A testemunha não transacional confirma uma execução por caso; a correção desfaz usuário, auditoria e alteração da comprovação, restaurando presença, timestamp textual e geração originais. Controles positivos passaram antes dos triggers, e o catálogo foi restaurado.

As 14 regressões incluem links, estrutura, pessoas, HTTP/edição, ciclo de vínculos, comandos/revogações/criação/concessões/equipes, convite público, 31 casos novos de comandos de convites e os cinco casos originais de capacidades de usuários. Cada arquivo conserva seus limites; a retirada do vínculo global observa uma intercalação, sem demonstrar espera real de lock.

## Execução e recursos

Todas as três rodadas V2 observaram o HEAD `b77ea42ce899d04f7a4b65c79b348ccdd50a52ac`, com igualdade das 994 fontes canônicas e 1.039 fontes compostas antes/depois. Quatro fases de resolução/tipos passaram, abrangendo 35 testes e 14 fontes obrigatórias, sem resolver código de outro checkout.

| Rodada | Início UTC em 09/11 | Fim UTC em 09/11 | Resultado |
| --- | --- | --- | --- |
| Baseline V2 | 00:27:44.388 | 00:28:01.839 | 11 PASS /10 FAIL previstos |
| Candidato V2 | 00:29:28.504 | 00:29:47.011 | 21/21 |
| Regressões V2 | 00:30:11.762 | 00:32:51.869 | 213/213 TAP |

Esses horários correspondem à noite de 08/11 em São Paulo. Os registros UTC originais não foram alterados. Memória livre no início: 1.898/2.626/2.987 MiB; guard mantido em 1.536 MiB. PostgreSQL exclusivo, UUIDs temporários, app restrito e migração candidata 68 na fixture. Nas três rodadas: base vazia, bancos/clients temporários 0, seis roles/credenciais/configurações restauradas, filhos registrados encerrados e contêiner conferido sem reinício/OOM. Outros projetos não foram parados por esta tarefa; o computador não foi reiniciado.

## Tentativas preservadas

A [recusa inicial](../../evidencias/mfa-user-create-resource-refusal-2026-11-08.json) ocorreu com 740 MiB antes de iniciar o processo de preparação. Após recuperar memória, a V1 passou pelos tipos, mas a baseline teve 4 PASS /17 FAIL: quatro 409/403 e treze expectativas incorretas de `Cache-Control: no-store`, copiadas do router de tenancy. Os controles de trigger V1 pararam antes de instalar os triggers. O candidato funcional V1 não foi executado.

A V2 remove somente três asserções desse cabeçalho, preservando 21 casos e todas as verificações MFA/dados/auditoria. Produto idêntico nas duas versões. [Histórico com casos, hashes e limpeza](../../evidencias/mfa-user-create-attempts-2026-11-08.json). Esse arquivo registra o checkpoint anterior à execução funcional V2; este resultado e a prova final o complementam. A política de cache das rotas legadas permanece pendente, sem aceite por estes testes.

## Retomar

Use o [README e aplicador portátil](README.md). A [restauração real dos 1.039 arquivos passou](../../evidencias/mfa-user-create-restore-2026-11-08.json), com pai intacto e dois payloads conferidos. Isso verifica fontes; não instala dependências nem executa testes. O pacote congelado permanece separado deste resultado.

Neste host: `work/mfa-user-create-v2-{baseline,fixed,fixed-regression}-qa-20261108`, `work/mfa-user-create-v2-harness-20261108`, `work/verify-user-create-results-20261108.py` e `work/mfa-user-create-root-config-20261108.json`. Os metadados publicados em `QA` permitem identificar exatamente a prova; em outro computador, é necessário um ambiente QA e uma atestação novos, sem transportar credenciais.

Próximos: comandos de vínculos de usuários, suporte e configurações; política de cache privada; demais domínios, promoção/locks reais/exceções genéricas; regressão integrada, matriz de navegador, Android/iOS e requisitos operacionais. Nenhum teste de navegador ou aparelho foi reexecutado neste lote. Não há avaliação de desempenho nem garantia universal até o instante do commit.
