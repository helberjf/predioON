# Revisão independente dos três DELETEs de vínculos

Revisão estática em 07/11/2026. Nenhum bloqueador identificado nesta leitura. Isso não é aceite de tipos, PostgreSQL, RLS em execução, teste ou produção; nenhum serviço foi iniciado pelo revisor.

Candidato: `work/mfa-tenancy-revocation-candidate-20261107/after/apps/api/src/modules/tenancy/routes.ts`, SHA256 `37754d794909989eff26550ebe1a7fc549c939795961fe44fea2cc005f75967e`, 40.987 bytes. Before: `4089f119bb6e38367a09c7b17abeb950120e4524d9c379c49ea689ea870ef7f4`, 36.511 bytes. Comparação de bytes confirma que todo o prefixo anterior à seção de revogações está intacto. A comparação não executou código de produto.

## Contrato examinado

- Os três descritores são constantes de servidor. Tabela, capacidade e ação não derivam de entrada HTTP; o UUID continua validado antes da transação.
- A leitura escalar referencia o guard materializado tanto para a busca com lock quanto para o caso vazio. O `FOR UPDATE OF target` continua submetido às policies de UPDATE, preservando a diferença entre leitor e gestor. O binding global com prédio nulo não se transforma numa revogação global.
- O guard em statement novo após o lock é necessário: o snapshot de uma busca que esperou não é apresentado como decisão nova. O `assertCapability` real permanece antes da auditoria ou do retorno idempotente.
- No ramo inativo, a releitura ocorre com o lock já detido, e avalia MFA, visibilidade de escrita e capacidade no mesmo statement. O booleano adicional é interno; nenhum DTO novo é exposto.
- A auditoria continua antes da desativação. O UPDATE tem dependência do guard no mesmo statement, preserva policies USING/WITH CHECK e confere o ID retornado. Zero linhas causa 404 e rollback da auditoria: mudança deliberada e documentada, ainda sem reprodução deste interleaving.
- A checagem final é somente MFA. Não acrescentar capacidade após remover a própria concessão evita impedir autorrevogação legítima. Fator/prova modificados por trigger antes dessa checagem fazem parte da mesma transação e precisam de prova posterior de rollback.

Foram lidas as policies das três tabelas e `app_rbac_can_delegate` em `infrastructure/014-rbac-tenancy.sql`, o guard STABLE de `068-platform-mfa-required.sql`, a auditoria de `036-audit-capabilities.sql` e o `assertCapability`/mapeamento de contexto da API. O guard STABLE usa o snapshot do statement; esta revisão não afirma serialização de toda alteração externa até o commit.

## Pontos a preservar no teste em autoria

O novo lock também contém `app_has_capability`. Uma barreira que procura somente essa substring pode parar antes do `assertCapability`; deve reconhecer o SELECT separado real e observar seu resultado permitido. No baseline, os builders ORM precisam executar sem substituição de autorização.

Cerimônia MFA deve ser HTTP/TOTP real no mesmo bearer/SID. O teste anterior de seis PATCHs contém setup sintético de fator/prova e não deve ser copiado como se fosse cerimônia real. Remoções owner para produzir o interleaving são distintas de fabricar prova positiva.

Negativos devem comparar vínculo e auditoria completos e, quando o baseline retornar 204, confirmar que houve efeito ou idempotência correspondente. Incluem UUID válido ausente, no-op, leitor oculto por policy de escrita e binding global. Autorrevogação direta e por equipe requerem acesso permitido antes e perda de gestão depois.

Não foram revisados ainda o futuro teste comum, os resultados RED/GREEN, os locks reais durante espera, triggers, promoção após gate nem a corrida de perda de capacidade. Esses recortes permanecem pendentes até autoria/execução específica. Nenhum arquivo congelado ou do repositório foi alterado.
