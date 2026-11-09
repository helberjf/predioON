# Organizações: integração da suíte legada com MFA

Pacote de uma fixture de teste sobre a composição de organizações/1.049 fontes. O destino mantém 1.049 fontes; produto e todos os demais arquivos preservados. As 19 verificações de negócio, SQLs, bloqueios, triggers e prazos originais permanecem iguais.

```powershell
node ./apply-organization-legacy.mjs --candidate <pasta-organizacoes-com-1049-fontes> --output <nova-pasta-do-legado>
```

O aplicador verifica hashes e tamanhos do pacote, do pai e do destino; usa pasta nova e preserva a entrada. Não instala dependências, copia ambientes/caches/credenciais, inicia serviços, aplica migrações ou executa testes. O recibo `API-ORGANIZATION-LEGACY-RESTORE-RECEIPT.json` comprova restauração de fontes.

A preparação dos usuários fictícios usa login, inscrição e TOTP por HTTP real. O mesmo bearer/SID é utilizado nas chamadas HTTP e nos contextos SQL restritos, sem fabricar fator ou prova de sessão. Resultado funcional e limites ficam separados deste pacote. MFA obrigatória 068 permanece candidata; runtime main 001–067. Leia `docs/CONTINUIDADE.md` para retomar a cadeia e as pendências. Não reiniciar este computador.
