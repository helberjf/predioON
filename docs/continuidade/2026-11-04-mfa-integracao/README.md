# Continuidade da integração MFA — 04/11/2026

Este checkpoint preserva código candidato em patches. **A API publicada continua em001–067 e a obrigatoriedade administrativa ainda não está entregue.** Não aplicar este conjunto a produção nem ao banco067: a migration candidata e a fronteira SQL ainda estão incompletas.

## Conteúdo recuperável

- `backend.patch`:16 arquivos cumulativos, incluindo15 fontes e um arquivo com sete testes puros. Contém os quatro arquivos de prova por família do checkpoint anterior, estado por sessão/contrato/schema/contexto, bootstrap em uma consulta, gate HTTP com exceções explícitas e mapeamento PMF01/02. As cinco emissões SSE são feitas após a transação terminar.
- [MANIFESTO.json](MANIFESTO.json): base exata, hashes antes/depois, hash do patch e restauração conferida dos16 arquivos. Não é uma restauração completa do projeto.
- [Nove casos de banco e SQL candidato](../2026-11-04-mfa-candidato/README.md): continuam separados. Para observar o comportamento ausente na base067, aplicar **somente** o patch antigo `testes-red.patch`, sem o backend novo. Esses nove casos não foram executados.

O patch é cumulativo sobre `b259f80b158aff08f255a83f9d8ae551289d5fcf`. Em uma cópia isolada dessa base, conferir primeiro `git apply --check backend.patch`, aplicar e verificar os hashes do manifesto. Não aplicar por cima do patch antigo `prova-por-familia.patch`, nem escolher arquivos avulsos. Antes de usar uma main posterior, comparar os arquivos para evitar reaplicação.

## Verificação observada

[Prova e limites](../../evidencias/mfa-http-candidate-2026-11-04.json): sete testes puros passaram. Eles verificam classificação/erros, sem HTTP, SSE ou banco. A primeira invocação falhou por resolução do loader antes de executar os casos; a correção apenas usou o pacoteAPI existente.

O TSC da API candidata terminou em timeout/SIGTERM sem saída: **não há aprovação de tipos deste conjunto**. O prazo configurado era300s, mas a duração observada foi1066s; a causa do atraso não foi estabelecida. Fonte e overlays permaneceram idênticos, e nenhum Node próprio desse ensaio ficou ativo. O PASS de tipos do candidato antigo de quatro arquivos não cobre estes incrementos.

## Próximo trabalho necessário

1. Completar guards SQL na mesma observação que concede acesso: organizações, devices, projeções globais e resultados vazios, sem interpretar ausência de linhas como MFA. A068 candidata cobre só três políticas.
2. Revisar mutadores, expiração durante espera, readback de prova e corrida de promoção ao desativar fator. Não alterar migrations001–067.
3. Integrar consumidores web/mobile com cerimônia de MFA acima dos providers privados, mantendo códigos somente em memória até confirmação explícita; preservar a identidade em atualizações de autorização.
4. Rodar os nove casos dirigidos em UUID nova com a fixture oficial, depois SQL/ACL, HTTP/SSE, fixtures atualizadas, regressões e Playwright. Não reduzir guards nem budgets para aprovar.
5. Conferir tipos, builds e aparelhos Android/iOS antes de qualquer aceite de produção. Os cinco vídeos existentes são históricos.

Sem reinício de computador, alteração de cobrança ou uso de credenciais reais neste checkpoint. A causa de CI foi [identificada no resumo autenticado](../../evidencias/ci-account-blocker-2026-11-04.json).
