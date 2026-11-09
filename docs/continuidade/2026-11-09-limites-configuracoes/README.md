# Fontes portáteis: promoção de acesso e condomínio ausente

Acrescenta um teste de 26 casos ao candidato de 1.047 fontes validado até revogação externa durante transições. Produto e arquivos anteriores preservados; destino com 1.048 fontes. Não instala dependências, aplica migrações, inicia serviços ou executa testes.

Restaurar primeiro a cadeia até `2026-11-09-transicoes-concorrentes`. Então, com Node.js e um destino novo:

```powershell
node ./apply-feature-command-boundaries.mjs --candidate <pasta-com-1047-fontes> --output <nova-pasta-com-1048-fontes>
```

Hashes e tamanhos do pacote, pai e destino são conferidos; somente arquivos do inventário são copiados. Credenciais, ambiente, dependências, caches e compilações não acompanham o pacote. O recibo `API-FEATURE-COMMAND-BOUNDARIES-RESTORE-RECEIPT.json` documenta restauração de fontes, sem repetir a rodada funcional.

Os testes usam SQL real e observadores que pausam a operação depois de limites específicos: contexto, capacidade global ou descoberta do condomínio. Dezesseis promoções devem exigir MFA imediatamente e permitir recuperação pela mesma sessão com HTTP real. Oito retiradas de prova/fator devem prevalecer sobre alvo ausente; dois controles preservam 404 para administrador satisfeito. Dados, auditoria e notificações são conferidos. Os resultados e limites são publicados separadamente; este pacote isolado não é aceite de produção.
