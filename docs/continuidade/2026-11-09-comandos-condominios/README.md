# Condomínios: pacote portátil de comandos MFA

Aplica dois arquivos sobre a cadeia até limites de organizações (1.051 fontes). Produz 1.052 fontes: router de condomínios e um teste novo de 32 casos. Resultados funcionais e histórico das fixtures ficam separados em RESULTADO.md.

```powershell
node ./apply-building-commands.mjs --candidate <pasta-com-1051-fontes> --output <nova-pasta-com-1052-fontes>
```

Confere seis arquivos internos, pai, dois payloads e destino completo. Rejeita destino existente e preserva o pai. Não instala dependências, copia credenciais/caches/node_modules, aplica migrações ou inicia serviços/testes. O recibo API-BUILDING-COMMANDS-RESTORE-RECEIPT.json comprova somente restauração das fontes.

POST/PATCH verificam MFA vigente após capacidades, antes/depois dos pontos de gravação, após auditoria e antes de interpretar alvo vazio. SQL de escrita, bloqueio FOR UPDATE, capacidades globais/locais, GET, contratos, ordem da auditoria na desativação e migrações/políticas são preservados. Usuários comuns mantêm MFA opcional.

Os 32 casos dirigidos usam cerimônia MFA real, SQL original e controles de administração global/local, isolamento, edição parcial, desativação, alvos ausentes e valores padrão. Asserções de auditoria seguem a migração036: criação é PLATFORM e edição é BUILDING. Três regressões planejadas somam 30 casos. V1 não executou funcionalmente por sintaxe; V2 separa16 falhas MFA e três expectativas de auditoria; V3 corrige somente essas expectativas, sem alterar produto, matriz ou prazos.

Esperas externas, promoção/triggers, cache privado, demais domínios, integração e portais/apps/hardware/operação seguem no plano. MFA068 candidata; runtime main001–067, sem aceite global de produção. Não reiniciar o computador.
