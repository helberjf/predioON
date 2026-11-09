# Organizações: espera concorrente e conflito de cadastro

Pacote de fontes sobre a cadeia até o legado de organizações (1.049 arquivos). Produz 1.050 arquivos: router corrigido e teste novo de 15 casos. Resultados funcionais são publicados separadamente em RESULTADO.md.

```powershell
node ./apply-organization-waits.mjs --candidate <pasta-com-1049-fontes> --output <nova-pasta-com-1050-fontes>
```

O aplicador confere os seis arquivos internos, pai, dois payloads e destino completo. Rejeita destino existente e preserva o pai. Não instala dependências, copia credenciais/caches/node_modules, aplica migrações ou inicia serviços/testes. O recibo API-ORGANIZATION-WAITS-RESTORE-RECEIPT.json comprova somente restauração das fontes.

Após erro de unicidade, a transação original já foi revertida. POST/PATCH passam a conferir MFA e capacidades em uma nova transação antes de informar conflito. Usuários ainda autorizados conservam a resposta 409 original. SQL de gravação, bloqueios, GET, contratos, migrações e políticas continuam iguais.

Os 15 casos usam login, inscrição e TOTP reais, comprovam bloqueio pelo PID exato e cobrem espera em linha, auditoria e índice único. Controles positivos preservam cadastro/edição ou conflito; retiradas de prova/fator exigem 403 e nenhum efeito do comando. Os 66 casos de regressão planejados incluem organizações dirigidas/legadas, envelopes SQL e obrigatoriedade MFA.

MFA 068 continua candidata; runtime main 001–067. Promoção, revogação de capacidade no conflito, demais domínios, integração total e aceites de portais/Android/iOS/hardware/operação seguem no plano. Leia docs/CONTINUIDADE.md na retomada. Não reiniciar este computador.
