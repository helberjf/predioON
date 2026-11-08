# Revisão independente do teste comum de revogação

Revisão estática em 07/11/2026, sem execução de Node, tipos, banco, serviços ou testes. Nenhum bloqueador identificado no arquivo `work/mfa-tenancy-revocation-test-20261107/apps/api/test/platform-mfa-tenancy-revocations.test.ts`, SHA256 `62f4d7b81bf9c97f78a08fe1694f0d5c47c8f243d98d411212713f465551bfed`, 22.775 bytes. O código do autor não foi editado pelo revisor.

São 21 casos independentes, uma suite describe e zero grupos agregadores. As expectativas são baseline com nove controles aprovados e doze negativos falhando na diferença esperada de status; fixed com 21 aprovados. Ainda não são resultados de execução. O manifesto lido contém 21 disposições e o mesmo hash/bytes do teste.

## Pontos conferidos

- A barreira delega cada execução ao banco real antes de observar o resultado. O SELECT separado de `assertCapability` precisa começar com `select app_has_capability(`, conter capacidade e prédio esperados e retornar allowed=true. O CTE de lock do candidato não satisfaz esse prefixo. Os casos ausentes param na fronteira de contexto autenticado, antes do lookup; isso não é uma alegação de autorização de linha inexistente.
- Atores novos por negativo fazem login, enrollment e confirmação TOTP reais no mesmo bearer/SID. Há leitura do fator confirmado e geração correspondente e confirmação `/auth/me=satisfied`. A fixture não insere fatores falsos nem restaura aprovação. Owner remove fator/prova somente depois da fronteira observada.
- Os seis negativos ativos demonstram previamente a operação positiva; depois comparam o efeito completo e a auditoria exata caso o baseline responda 204. Os três no-ops comparam inclusive timestamp intacto e auditoria ausente. Os três UUIDs ausentes comparam corpo 404 com o controle, ausência de linha e auditoria. Erro genérico, deadline, falha de fixture ou 500 não satisfaz a previsão RED.
- Os seis controles optional/satisfied conferem revogação persistida, 204 vazio, no-store, campos conservados, timestamp avançado e auditoria exata; a repetição não cria novo efeito. Dois controles de autorrevogação conferem a primeira operação e a perda de gestão posterior, direta ou via equipe.
- O leitor usa contexto runtime com identidade e SID de login reais para provar leitura da própria linha antes de receber 404 no DELETE submetido a policy de escrita. Alvo estrangeiro, binding global e UUID malformado são distinguidos. As colunas, FKs e tipos utilizados conferem com a fonte examinada.
- O proxy é liberado/restaurado em finally e todas as transações app são rastreadas, inclusive chamadas posteriores. Cleanup tem HTTP/barreiras/settle limitados a cinco segundos, lock timeout de dois e statement timeout de três; fecha listener/pools e remove apenas os dados desta fixture. Não há retry automático, skip ou enfraquecimento das assertivas.
- O orçamento de admissão da migration035 permite 300 admissões por rede e 20 por conta. O lote em fixture fresca usa contas distintas, com três admissões para cada administrador; não há exaustão intrínseca desse orçamento por estes 21 casos. Uma eventual recusa continua falha de setup, não é escondida por retry.

## Limites mantidos

Este teste não induz espera real de lock, promoção após gate, perda de capacidade durante espera, trigger de auditoria/UPDATE nem UPDATE sem correspondência após auditoria. Não prova linearização até commit nem substitui regressão dos demais comandos. Nada nesta revisão aceita browser, mobile, performance ou produção.

O arquivo deve permanecer byteidêntico nos dois lados. O root precisa executar fontes congeladas, revisar os doze erros baseline e a limpeza, e só então publicar os números reais. A suite describe não deve inflar a contagem de testes TAP.
