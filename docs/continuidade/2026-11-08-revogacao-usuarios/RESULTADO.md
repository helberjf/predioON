# Revogação de vínculos: resultado de MFA em 08/11/2026

**Aceite dirigido do candidato, sem aceite de produção.** Os 48 casos do mesmo teste passaram após reproduzir 24 divergências na baseline: vinte respostas 204 e quatro 404 onde se exigia 403. Passaram também dezesseis arquivos de regressão, com 268 entradas TAP, 258 casos independentes e dez grupos. A composição corrigida soma **316 TAP /306 casos independentes /dez grupos**, sem somar baseline ou rodadas históricas. Zero falhas, cancelamentos, skips ou TODO nos resultados corrigidos. [Prova auditada](../../evidencias/mfa-user-revocation-2026-11-08.json).

## Fontes e comportamento

O pai é o [candidato de vínculos de usuários/1.040 arquivos](../2026-11-08-vinculos-usuarios/RESULTADO.md); o destino tem 1.041. Somente `DELETE /users/memberships/:membershipId` mudou, e um novo arquivo de teste foi acrescentado. O restante do router foi reconstruído por comparação de texto; POSTs, outros handlers, schemas, helpers, ACL/policies e migrations permanecem iguais. O runtime da main conserva 001–067; a 068 continua candidata e não foi aplicada a uma instalação existente.

A leitura inicial observa MFA inclusive quando não encontra o vínculo. O UPDATE consome a decisão MFA materializada na mesma instrução, com resultado escalar decodificado explicitamente. Uma nova checagem MFA ocorre antes de concluir, inclusive no caminho de UPDATE sem linha. A auditoria continua antes da mutação: um gestor com autoridade apenas pelo próprio vínculo consegue revogá-lo sem uma checagem de capacidade posterior impedir a operação legítima. Preservam-se identidade, condomínio, usuário, papel, unidade, início de vigência e data de criação; a revogação altera apenas atividade, fim e data de atualização.

## O que foi exercitado

- Administradores por flag e por vínculo global, com inscrição HTTP/TOTP real na mesma família de sessão. Nenhuma comprovação positiva foi fabricada pelo owner.
- Doze retiradas de fator/comprovação após a autorização global real, para vínculos vigentes, inativos e expirados; oito retiradas após o lock de funcionalidades real, antes da leitura inicial de vínculo presente ou ausente. Os quatro caminhos vazios conferem ausência de efeito; não demonstram escrita indevida.
- Dezesseis combinações positivas de administrador por flag/vínculo global e gestor por vínculo local/legado, cobrindo vínculos vigentes, inativos, expirados e futuros. Conferência exata da linha, auditoria e perda de elegibilidade pelo mesmo token HTTP do usuário afetado.
- Autorrevogação do único vínculo de gestor legado, sem role binding remanescente: uma auditoria, perda de autoridade no mesmo token e nova recusa sem auditoria adicional. Revogações repetidas por gestor ainda autorizado mantêm uma auditoria por resposta bem-sucedida.
- Recusas de morador, escopo entre condomínios, UUID inválido/inexistente, ausência de login e retirada de autoridade global. Nenhuma revogação ou auditoria nas recusas.
- Quatro triggers estreitos retiram a comprovação durante UPDATE de vínculo ou INSERT de auditoria, em vínculos vigentes/inativos. Cada um dispara uma vez; a correção restaura dados, auditoria e presença/timestamp textual/geração originais da comprovação.
- Dois triggers lançam exceção genérica, e um trigger anterior ao UPDATE impede a alteração. O erro genérico permanece opaco para o cliente; o resultado sem linha conserva 409. Nos três casos, a auditoria anterior é desfeita e vínculo/comprovação permanecem intactos. Controles positivos precedem os triggers, e o catálogo é restaurado.

As dezesseis regressões incluem links, estrutura, pessoas, HTTP/edição, ciclo de vínculos, comandos/revogações/criação/concessões/equipes, convite público, comandos de convites, capacidades de usuários, criação de usuários e os 34 casos de criação/readmissão de vínculos. Cada arquivo conserva seus limites. As retiradas coordenadas são intercalações entre instruções; não provam espera real de lock do PostgreSQL.

## Execução e recursos

Todas as três rodadas observaram o HEAD `c8f990531819886f6181dd167bbe2bd6d8797587`, com igualdade das 994 fontes canônicas e 1.041 fontes compostas antes/depois. Quatro fases de resolução/tipos passaram, abrangendo 37 testes e 14 fontes obrigatórias, sem resolver código de outro checkout.

| Rodada | Início UTC em 09/11 | Fim UTC em 09/11 | Resultado | Memória inicial MiB |
| --- | --- | --- | --- | --- |
| Baseline | 01:05:54.972 | 01:06:21.509 | 24 PASS /24 FAIL previstos | 3696 |
| Candidato | 01:07:25.900 | 01:07:54.280 | 48/48 | 3843 |
| Regressões | 01:09:08.330 | 01:11:59.982 | 268/268 TAP | 3680 |

Os horários UTC acima correspondem à noite de 08/11 em São Paulo, sem alteração dos registros nativos. Guard mantido em 1.536 MiB. PostgreSQL exclusivo, UUIDs temporários, app restrito e migration candidata 068 na fixture. Nas três rodadas: base vazia, bancos/clients temporários zero, seis roles/credenciais/configurações restauradas, filhos registrados encerrados e contêiner conferido sem reinício/OOM. Não foi necessário parar os dois serviços de outro projeto: já estavam encerrados quando sua pausa foi autorizada. O computador não foi reiniciado.

## Retomar

Use o [README e aplicador portátil](README.md). A [restauração real dos 1.041 arquivos passou](../../evidencias/mfa-user-revocation-restore-2026-11-08.json), com pai intacto e dois payloads conferidos. Isso verifica fontes; não instala dependências nem executa testes. O pacote congelado permanece separado deste resultado. O [checkpoint anterior aos testes funcionais](../2026-11-08-revogacao-usuarios-rascunho/README.md) é preservado e complementado por este aceite.

Neste host: `work/mfa-user-revocation-{baseline,fixed,fixed-regression}-qa-20261108`, `work/mfa-user-revocation-harness-20261108`, `work/verify-user-revocation-results-20261108.py` e `work/mfa-user-revocation-root-config-20261108.json`. Os metadados publicados em `QA` identificam a prova; em outro computador, prepare ambiente QA e atestação novos, sem transportar credenciais.

Próximos: comandos de suporte e configurações, cache privado, demais domínios, promoção e esperas reais, exceções genéricas em outros caminhos, regressão integrada, matriz de navegador, Android/iOS e operação. Nenhum teste de navegador ou aparelho foi reexecutado neste lote. Não há avaliação de desempenho nem garantia universal até o instante do commit.
