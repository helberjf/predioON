# Recorte de prova MFA por família — candidato externo v1

Código proposto, NÃO EXECUTADO e NÃO GREEN. Quatro arquivos em `after/apps/api/src/auth`; os originais exatos estão em `before`. Nenhuma alteração no checkout, instalação, banco, teste, typecheck ou build. Apenas parser sintático TypeScript sem emissão.

Dependência obrigatória: `mfa-implementation-proposal-20261104/068-platform-mfa-required.candidate.sql` V2, com geração UUID, par de colunas de prova sem backfill e helper da união flag legado/021. Não aplicar o candidato API sobre schema067. Nenhuma migração foi aplicada. O hash da dependência está no manifesto. O plano e sua corrigenda de política foram consultados.

## Código entregue

- `consumeMfaCode` retorna `{ generation } | null`. TOTP conserva janela e consumo único, acrescentando CAS da geração. Recovery conserva o hash/consumo original, mas trava o fator confirmado da geração observada durante o UPDATE do código; DELETE/INSERT do fator não pode retargetar essa prova. Não há novo contrato HTTP para o código.
- Login mantém KDF e consumo antes do lock de conta. Sob o lock reconfirma hash/conta e fator atual; fator habilitado ou substituído nesse intervalo rejeita a criação. A nova família recebe prova somente da geração consumida; código gasto continua gasto se a criação posterior falhar. Sem fator confirmado, o login conserva comportamento atual e não fabrica prova.
- Enroll reconfirma senha sob lock de conta e valida/trava família atual antes de substituir inscrição pendente. A inserção continua gerando uma nova geração por default068.
- Confirm segue conta → família → fator, CAS por geração e ciphertext, confirma uma vez, cria dez recovery codes e grava prova somente na família atual ativa. Tudo na mesma transação; resposta com códigos só após commit. Não atualiza `verified_at`055.
- Verify faz KDF/consumo fora dos locks, reconfirma hash/conta e família, trava/reconfirma geração e grava `verified_at`055 e prova MFA na mesma transação. Senha sem fator confirmado continua permitida para conta opcional, mas nunca produz prova MFA.
- Disable verifica a obrigação atual antes de gastar código e novamente depois de conta → família → fator. Admin vigente recebe403/MFA_REQUIRED. Não-admin preserva senha+código; CAS impede apagar fator substituído. A segunda observação NÃO resolve toda promoção concorrente posterior; ver limites.
- Refresh intocado: não estende nenhum relógio de comprovação. O campo055 nunca é usado como prova do fator. Os três callers de consumo foram inventariados nos três arquivos consumidores.

## Limites de integração, ainda pendentes

Este é somente o armazenamento/consumo de prova, não a entrega de MFA obrigatória. DTO/estado por família, gate HTTP/allowlist/SSE/heartbeat, RLS e snapshot da operação, clientes/UI/mobile, schema Drizzle e fixtures não foram alterados. Por isso o login administrativo sem fator ainda não restringe acesso nesta cópia. Não publicar o conjunto como proteção completa.

A promoção/revogação de binding ou flag entre o helper de disable e a escrita continua pendente de resolução na fronteira de autorização. Não se afirma segurança linearizável. O helper gera403 com reason MFA_REQUIRED para disable; contrato final deve reconciliar o motivo com consumidores. Nenhum mapeamento de erro SQL novo é entregue.

As colunas068 são acessadas por SQL explícito para manter este patch limitado; o schema Drizzle deverá ser atualizado na integração (sem alterar defaults ou inventar backfill). A geração não sai no DTO. A validade de provas antigas depende da comparação com a geração atualmente confirmada, no helper068/consumidores futuros; apagar fator não apaga provas históricas de sessões.

Ainda é necessária verificação de tipos completa. Erros SQL inesperados seguem tratamento central atual; não há logs de segredo/DSN adicionados. Testes de persistência contra triggers adversários que suprimam/revertam gravações também não foram executados; o candidato confere RETURNING, sem alegar readback pós-trigger completo.

## Próximas provas dirigidas

1. Mesmo TOTP/recovery em duas chamadas: exatamente um consumo/prova; fator substituído antes do CAS retorna nulo.
2. Recovery lido em geraçãoA, substituição porB concorrente: não consumir código/provarB comA; lock liberado antes de account lock.
3. Login: barreira após consumo/antes account lock, reenroll/removal e password change; nenhuma família com prova inválida. Fator habilitado após leitura inicial sem MFA deve impedir login sem prova.
4. Confirm em famíliasA/B: somenteA recebe prova; replay/pending substituído/expired/revoked family não retorna códigos nem altera fator/códigos parcialmente.
5. Verify: password hash alterado ou fator substituído após consumo; ambos relógios rollback. Verificação normal atualiza somente família corrente.
6. Refresh mantém ambos relógios; inscrição confirmada não renova055; não-admin continua opcional.
7. Disable admin flag/binding vigente:403, fator/recovery intactos; não-admin com código atual pode remover; substituição/promoção concorrente têm controles separados, sem chamar a lacuna resolvida.

Status destas provas: NÃO EXECUTADAS. O lote RED9 paralelo contra fonte original é outra evidência, não valida este candidato automaticamente.
