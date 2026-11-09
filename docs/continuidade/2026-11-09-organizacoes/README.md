# Organizações: pacote portátil de fontes

Aplica dois arquivos sobre a cadeia validada até promoção/alvo ausente em configurações, com 1.048 fontes. O destino tem 1.049 fontes: router de organizações atualizado e um teste novo de 30 casos. Resultado funcional e limites são publicados separadamente; restauração confere somente fontes.

```powershell
node ./apply-organization-commands.mjs --candidate <pasta-com-1048-fontes> --output <nova-pasta-com-1049-fontes>
```

O aplicador verifica os seis arquivos internos, o pai, os dois payloads e o destino completo. Rejeita pasta de destino existente e preserva o pai. Não instala dependências, copia credenciais/caches/node_modules, aplica migrações, inicia serviços nem executa testes. O recibo `API-ORGANIZATION-COMMANDS-RESTORE-RECEIPT.json` é de restauração, não de aceite funcional.

POST/PATCH passam a conferir explicitamente MFA e as duas capacidades comerciais, inclusive após gravação, espera/auditoria e antes de interpretar resultado vazio ou retornar dados. SQL de gravação, lock NO KEY UPDATE, políticas restritivas do banco, GET, esquemas e migrações permanecem iguais. Os 30 casos dirigidos usam cerimônia MFA real; duas regressões planejadas somam 17 casos. O observador V2 corrige o encaminhamento de erros, antes de execução funcional, sem mudar asserções ou prazos.

MFA obrigatória 068 segue candidata e o runtime da main usa 001–067. Demais comandos, testes legados, esperas MFA externas, promoção/triggers, integração completa, web/apps e operação continuam no plano. Leia `docs/CONTINUIDADE.md` ao retomar em outro computador e use um ambiente próprio de testes. Não reiniciar este computador.
