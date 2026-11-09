# Cadastro da equipe de suporte: resultado de MFA em 08/11/2026

**Aceite dirigido do candidato, sem aceite de produção.** Os 36 casos do mesmo teste V2 passaram após reproduzir 18 divergências na baseline: seis respostas 201, quatro 409, quatro 400 e quatro 404 onde se exigia 403. Passaram também quatro arquivos de regressão, com 32 entradas TAP, 28 casos independentes e quatro grupos. A composição corrigida soma **68 TAP / 64 casos independentes / quatro grupos**, sem somar baseline ou rodadas históricas. Zero falhas, cancelamentos, skips ou TODO nos resultados corrigidos. [Prova auditada](../../evidencias/mfa-support-staff-create-2026-11-08.json).

## Fontes e comportamento

O pai é o [candidato de revogação de usuários/1.041 arquivos](../2026-11-08-revogacao-usuarios/RESULTADO.md); o destino tem 1.042. Somente `POST /v1/support-access/staff` mudou, e um novo arquivo de teste foi acrescentado. O restante do router foi reconstruído por comparação de texto; DELETE da equipe, concessão/substituição/revogação de acessos, helpers, schemas, ACL/policies e migrations permanecem iguais. O runtime da main conserva 001–067; a 068 continua candidata e não foi aplicada a uma instalação existente.

As consultas da pessoa e da duplicidade observam MFA inclusive quando retornam vazias. O INSERT consome a decisão MFA materializada na mesma instrução, com resultado escalar e identificador decodificados explicitamente. Uma nova checagem MFA ocorre após a auditoria antes de concluir. Preservam-se autorização global, confirmação recente da senha, razão normalizada, resposta com um identificador e auditoria de plataforma. Entrar na equipe não concede acesso a um condomínio.

## Casos exercitados

- Administradores por flag e por vínculo global, com inscrição HTTP/TOTP real na mesma família de sessão. Nenhuma comprovação positiva dos 36 casos foi fabricada pelo owner.
- Dezesseis retiradas de fator/comprovação após a autorização global real, para pessoa nova, membro existente, conta inativa ou pessoa ausente. Nos caminhos de criação da baseline foram conferidos linha exata, conta inalterada, auditoria e ausência de acesso a condomínio. Nos caminhos de recusa, os dados não mudaram; esses casos não demonstram gravação indevida.
- Oito combinações positivas por autoridade e estado novo/revogado/papel local/autocadastro. Identidade e histórico são preservados; nenhum acesso implícito a condomínio é acrescentado. Listagem confere o novo vínculo e seus seis campos públicos.
- Confirmação de senha expirada: recusa sem alteração, recuperação real por HTTP com senha e código de recuperação, seguida de cadastro bem-sucedido. Schema estrito, espaços normalizados e razão com apóstrofo exercitados.
- Duplicidade de vínculo ativo, inclusive expirado; conta inativa/ausente; gestor local/morador; ausência de login. A retirada do único vínculo global mantém o 404 da pessoa que deixou de ser visível, sem cadastro ou auditoria.
- Dois triggers estreitos retiram a comprovação durante INSERT de papel ou auditoria. Cada um dispara uma vez; a correção restaura contas, papéis, concessões, auditoria e presença/timestamp textual/geração originais da comprovação.
- Dois triggers lançam exceção genérica, e um trigger anterior ao INSERT impede a gravação. O erro permanece opaco para o cliente. Dados e comprovação ficam intactos; controles positivos precedem os triggers de prova/exceção e o catálogo é restaurado.

As regressões abrangem suporte completo, leitura protegida das concessões, ordenação temporal e diretórios administrativos. Os testes históricos de leitura usam fixtures SQL de fator/prova e mantêm essa limitação; os novos 36 casos usam inscrição real. As retiradas coordenadas são intercalações após uma instrução SQL verdadeira, sem resultado de autorização fabricado; não provam espera real de lock nem segurança de dois primeiros cadastros simultâneos.

## Tentativa V1 preservada

A [baseline V1](../../evidencias/mfa-support-staff-create-v1-review-2026-11-08.json) teve 16 PASS/20 FAIL: 18 divergências MFA esperadas e dois erros de preparo, porque a chamada de confirmação recente enviava somente a senha apesar do MFA ativo. V2 acrescenta apenas `code:a.codes[0]`, gerado na inscrição HTTP real. Produto, asserções e estados esperados não mudaram. Todos os 36 casos foram repetidos em baseline e candidato novos. Não somar V1 ao resultado corrigido. Os [rascunhos V1](../2026-11-08-cadastro-suporte-rascunho/README.md) e [V2](../2026-11-08-cadastro-suporte-rascunho-v2/README.md) continuam congelados como checkpoints anteriores ao aceite.

## Execução e recursos

Todas as três rodadas V2 observaram o HEAD `5e9d92d1329baec726f0686ab0f75386a54d00a1`, com igualdade das 994 fontes canônicas e 1.042 fontes compostas antes/depois. Quatro fases de resolução/tipos passaram, abrangendo 38 testes e 14 fontes obrigatórias, sem resolver código de outro checkout.

| Rodada V2 | Início UTC em 09/11 | Fim UTC em 09/11 | Resultado | Memória inicial MiB |
| --- | --- | --- | --- | --- |
| Baseline | 01:41:22.240 | 01:41:41.248 | 18 PASS / 18 FAIL previstos | 4671 |
| Candidato | 01:42:34.351 | 01:42:55.320 | 36/36 | 4668 |
| Regressões | 01:43:09.273 | 01:43:39.407 | 32/32 TAP | 4591 |

Os horários UTC acima correspondem à noite de 08/11 em São Paulo, sem alteração dos registros nativos. Guard mantido em 1.536 MiB. PostgreSQL exclusivo, UUIDs temporários, aplicação com permissões restritas e migration candidata 068 na fixture. Nas três rodadas: base vazia, bancos/clients temporários zero, seis roles/credenciais/configurações restauradas, filhos registrados encerrados e contêiner conferido sem reinício/OOM. O computador não foi reiniciado. A revisão V1 também confirma sua limpeza.

## Retomar

Use o [README e aplicador portátil](README.md). A [restauração real dos 1.042 arquivos passou](../../evidencias/mfa-support-staff-create-restore-2026-11-08.json), com pai intacto e dois payloads conferidos. Isso verifica fontes; não instala dependências nem executa testes. O pacote congelado permanece separado deste resultado.

Neste host: `work/mfa-support-staff-create-v2-{baseline,fixed,fixed-regression}-qa-20261108`, `work/mfa-support-staff-create-v2-harness-20261108`, `work/verify-support-staff-create-v2-results-20261108.py` e `work/mfa-support-staff-create-v2-root-config-20261108.json`. Os metadados publicados em `QA` identificam a prova; em outro computador, prepare ambiente QA e atestação novos, sem transportar credenciais.

Próximos: remoção da equipe, concessão/substituição/revogação de suporte, configurações, cache privado, demais domínios, promoção e esperas reais, exceções genéricas em outros caminhos, regressão integrada, matriz de navegador, Android/iOS e operação. Nenhum teste de navegador ou aparelho foi reexecutado neste lote. Não há avaliação de desempenho nem garantia universal até o instante do commit.
