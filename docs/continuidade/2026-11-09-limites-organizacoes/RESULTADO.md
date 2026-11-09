# Organizações: promoção, autoridade e reversão

**36/36 casos independentes passaram**, uma suíte, sem falhas/cancelamentos/skips/TODO. [Prova completa](../../evidencias/mfa-organization-boundaries-2026-11-09.json). Um teste novo; produto e todas as 1.050 fontes do pai permaneceram idênticos. Os 81 casos anteriores não foram repetidos nem somados.

## Cenários e resultados

Dezesseis combinações de POST/PATCH, promoção por flag/vínculo global, ausência de fator/fator sem prova e intenção de sucesso/conflito. A requisição é admitida como usuário comum; um observador pausa após a configuração SQL real do contexto, sem substituir resultados. A promoção externa faz a consulta real de capacidade global retornar verdadeiro, mas a operação exige MFA antes de gravar ou informar conflito. O mesmo bearer/SID recupera o acesso por inscrição/TOTP ou código de recuperação reais. Após isso, contrato de sucesso ou 409 original é preservado; o caso de conflito também termina com uma operação válida conferida.

Quatro esperas reais no índice único retiram a flag ou o vínculo global enquanto o MFA continua comprovado. O teste observa a consulta original da API bloqueada pela conexão exata que realiza a retirada. Alteração de autoridade e liberação do bloqueio são confirmadas na mesma transação. O acesso é negado com 403; só o cadastro concorrente externo permanece. Dados do comando e auditoria não mudam.

Dezesseis triggers AFTER restritos à sessão/ator/alvo retiram prova, fator ou vínculo, ou lançam exceção após gravação ou auditoria. Uma sequência comprova exatamente uma execução do efeito real, mesmo após rollback. Comandos retornam 403 ou 500 sanitizado e revertem organizações, auditorias e as próprias mudanças de identidade feitas dentro da transação. Fator e códigos de recuperação são comparados por impressão de todas as suas linhas, sem publicar segredos. As funções temporárias usam search_path restrito, não permitem execução pública e são removidas com as sequências/triggers; catálogo original conferido.

Os sucessos também verificam os sete campos do DTO, datas, metadados, armazenamento, histórico e organizações não relacionadas.

## Execução e portabilidade

Commit observado: `d4abfd4d1b367018fbd469df6786e8620b0d946e`. Início UTC `2026-11-09T14:01:14.869Z`; fim `2026-11-09T14:01:50.887Z`. Resolução/tipos passaram para 50 testes/15 fontes obrigatórias. Memória inicial 2413 MiB; mínimo 1.536 MiB mantido. Banco UUID removido, seis papéis/credenciais/configurações restaurados, filhos encerrados, fontes e contêiner conferidos. Solicitação temporária de atividade retirada. **Sem reiniciar o computador**.

[Pacote](README.md) 1.050 → 1.051 arquivos, somente um payload de teste. [Recibo de restauração](../../evidencias/mfa-organization-boundaries-restore-2026-11-09.json). QA inclui o log TAP original com extensão .txt, o verificador e os registros de preparação.

## Limites e sequência

Sem alteração de produto nesta etapa; não há comparação baseline/corrigida nova. Seguir comandos dos demais domínios, cache privado, regressão completa API/ingest e aceites de portais, Android/iOS, hardware e operação. Não houve navegador/build/aparelho ou avaliação de desempenho neste lote. MFA 068 continua candidata; runtime main 001–067, sem aceite global de produção. Retomar por [CONTINUIDADE](../../CONTINUIDADE.md).
