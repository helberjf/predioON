# Vínculos de usuários: resultado de MFA em 08/11/2026

**Aceite dirigido do candidato, sem aceite de produção.** Os 34 casos do mesmo teste V2 passaram após reproduzir 16 respostas 201 onde se exigia 403 na baseline. Passaram também quinze arquivos de regressão, com 234 entradas TAP, 224 casos independentes e dez grupos. A composição corrigida soma **268 TAP /258 casos independentes /dez grupos**, sem somar baseline ou tentativas históricas. Zero falhas, cancelamentos, skips ou TODO nos resultados corrigidos. [Prova auditada](../../evidencias/mfa-user-membership-2026-11-08.json).

## Fontes e comportamento

O pai é o [candidato de criação de usuários/1.039 arquivos](../2026-11-08-criacao-usuarios/RESULTADO.md); o destino tem 1.040. Somente `POST /users/memberships`, incluindo seu decoder local de dez campos, mudou, e um novo arquivo de teste foi acrescentado. O restante do router foi reconstruído por comparação de texto; DELETE, outros handlers, schemas, helpers, ACL/policies e migrations permanecem iguais. O runtime da main conserva 001–067; a 068 continua candidata e não foi aplicada a uma instalação existente.

O INSERT/ON CONFLICT consome a decisão MFA materializada na mesma instrução e valida seu resultado escalar. Uma nova checagem após auditoria impede concluir os cenários testados com comprovação retirada. Mantêm-se autorização global ou local, confirmação recente para conceder BUILDING_ADMIN, dez campos públicos, ID e data de criação de vínculos existentes, janela vigente/futura e auditoria exata. A readmissão de vínculos inativos ou expirados limpa a janela anterior; editar vínculos vigentes ou futuros preserva suas datas.

## O que foi exercitado

- Administradores pelo flag legado e por vínculo global, ambos com inscrição HTTP/TOTP real e mesma família de sessão. O owner não fabrica comprovação positiva.
- Retirada do fator ou da comprovação após a autorização global real: criação, readmissão de inativo e de expirado. As doze recusas corrigidas mantêm vínculos e auditoria iguais à fotografia anterior; a baseline comprova os efeitos antes de falhar no status esperado.
- Quinze combinações positivas: dois tipos de administrador e gestor local, com vínculo ausente, inativo, expirado, vigente ou futuro. Conferência completa do DTO, linha persistida, janela, identidade, data de criação, auditoria e elegibilidade pelo mesmo token HTTP do usuário afetado.
- Concessão de BUILDING_ADMIN exige confirmação recente; a confirmação real recupera o acesso. Admissão comum de RESIDENT continua disponível. Gestor de outro condomínio e morador são recusados; entradas inválidas e referências inexistentes preservam os dados.
- Quatro casos de trigger estreito em vínculos e auditoria, para criação e readmissão. A testemunha não transacional confirma uma execução por caso. A correção desfaz vínculos, auditoria e alteração da comprovação, restaurando presença, timestamp textual e geração originais. Controles positivos passaram antes dos triggers, e o catálogo foi restaurado.

As quinze regressões incluem links, estrutura, pessoas, HTTP/edição, ciclo de vínculos, comandos/revogações/criação/concessões/equipes, convite público, comandos de convites, capacidades de usuários e os 21 casos anteriores de criação de usuários. Cada arquivo conserva seus limites. As retiradas coordenadas observam intercalações entre instruções, sem demonstrar espera real de lock.

## Execução e recursos

Todas as três rodadas V2 observaram o HEAD `f6631a8328eda6a342be28e85e6428d452a1482f`, com igualdade das 994 fontes canônicas e 1.040 fontes compostas antes/depois. Quatro fases de resolução/tipos passaram, abrangendo 36 testes e 14 fontes obrigatórias, sem resolver código de outro checkout.

| Rodada | Início UTC em 09/11 | Fim UTC em 09/11 | Resultado |
| --- | --- | --- | --- |
| Baseline V2 | 00:46:36.593 | 00:46:57.271 | 18 PASS /16 FAIL previstos |
| Candidato V2 | 00:50:49.386 | 00:51:11.810 | 34/34 |
| Regressões V2 | 00:51:32.702 | 00:54:01.618 | 234/234 TAP |

Esses horários correspondem à noite de 08/11 em São Paulo. Os registros UTC originais não foram alterados. Memória livre no início: 4.220/3.820/3.865 MiB; guard mantido em 1.536 MiB. PostgreSQL exclusivo, UUIDs temporários, app restrito e migration candidata 068 na fixture. Nas três rodadas: base vazia, bancos/clients temporários zero, seis roles/credenciais/configurações restauradas, filhos registrados encerrados e contêiner conferido sem reinício/OOM. O usuário autorizou pausar dois contêineres de outro projeto, mas ambos já estavam encerrados quando conferidos; não foi necessário pará-los. O computador não foi reiniciado.

## Tentativa anterior preservada

A [V1 teve erro de tipagem](../../evidencias/mfa-user-membership-types-2026-11-08.json): a inferência de `assert.deepEqual` estreitou o tipo da linha e tornou `id` inacessível ao compilador. Ambas as fases de resolução passaram, e ambas de tipos falharam com TS2339. Nenhum teste funcional V1 foi executado. A V2 acrescenta somente o parâmetro de tipo `Row`, sem alterar asserções em execução, casos ou produto. O [rascunho publicado](../2026-11-08-vinculos-usuarios-rascunho/README.md) conserva os arquivos e hashes; este resultado complementa seu estado anterior à execução funcional.

## Retomar

Use o [README e aplicador portátil](README.md). A [restauração real dos 1.040 arquivos passou](../../evidencias/mfa-user-membership-restore-2026-11-08.json), com pai intacto e dois payloads conferidos. Isso verifica fontes; não instala dependências nem executa testes. O pacote congelado permanece separado deste resultado.

Neste host: `work/mfa-user-membership-v2-{baseline,fixed,fixed-regression}-qa-20261108`, `work/mfa-user-membership-v2-harness-20261108`, `work/verify-user-membership-results-20261108.py` e `work/mfa-user-membership-root-config-20261108.json`. Os metadados publicados em `QA` permitem identificar exatamente a prova; em outro computador, é necessário um ambiente QA e uma atestação novos, sem transportar credenciais.

Próximos: `DELETE /users/memberships/:membershipId`, preservando autorrevogação e ordem da auditoria; suporte e configurações; cache privado; demais domínios, promoção/locks reais/exceções genéricas; regressão integrada, matriz de navegador, Android/iOS e requisitos operacionais. Nenhum teste de navegador ou aparelho foi reexecutado neste lote. Não há avaliação de desempenho nem garantia universal até o instante do commit.
