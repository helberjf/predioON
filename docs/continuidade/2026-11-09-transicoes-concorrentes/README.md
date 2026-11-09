# Fontes portáteis: revogação externa durante transições

Acrescenta um teste de 24 casos ao candidato de 1.046 fontes validado até reversão de transições. O produto e os arquivos anteriores são preservados; destino com 1.047 fontes. Não instala dependências, aplica migrações, inicia serviços ou executa testes.

Restaurar primeiro a cadeia até `2026-11-09-transicoes`. Então, usando Node.js e um destino novo:

```powershell
node ./apply-feature-transition-waits.mjs --candidate <pasta-com-1046-fontes> --output <nova-pasta-com-1047-fontes>
```

Hashes e tamanhos do pacote, pai e destino são conferidos; somente arquivos do inventário são copiados. Credenciais, ambiente, dependências, caches e compilações não acompanham o pacote. O recibo `API-FEATURE-TRANSITION-WAITS-RESTORE-RECEIPT.json` documenta restauração de fontes, sem repetir a rodada funcional.

Os testes usam inscrição/TOTP HTTP reais e bloqueio de uma linha por outra conexão. A revogação é confirmada enquanto a API espera pelo bloqueio: prova MFA, fator ou vínculo global. Cada caso confere rollback das tabelas de negócio e persistência apenas da retirada externa de identidade. Os resultados funcionais e limites são publicados separadamente; este pacote isolado não é aceite de produção.
