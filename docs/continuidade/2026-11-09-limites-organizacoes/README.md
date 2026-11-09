# Fontes portáteis: autoridade e reversão em organizações

Acrescenta um teste de 36 casos ao candidato de 1.050 fontes validado até as esperas/conflitos de organizações. Produto e fontes anteriores preservados; destino com 1.051 fontes. Não instala dependências, aplica migrações, inicia serviços ou executa testes.

Restaurar primeiro a cadeia até 2026-11-09-organizacoes-concorrentes. Então, com Node.js e um destino novo:

```powershell
node ./apply-organization-boundaries.mjs --candidate <pasta-com-1050-fontes> --output <nova-pasta-com-1051-fontes>
```

Hashes e tamanhos do pacote, pai e destino são conferidos; somente arquivos do inventário são copiados. Credenciais, ambiente, dependências, caches e compilações não acompanham o pacote. O recibo API-ORGANIZATION-BOUNDARIES-RESTORE-RECEIPT.json documenta somente restauração de fontes.

Dezesseis promoções exigem MFA e permitem recuperação pelo mesmo bearer/SID com inscrição/TOTP ou código de recuperação reais. Quatro esperas no índice único retiram flag/vínculo global, mantendo MFA, e devem recusar o conflito. Dezesseis triggers AFTER restritos retiram prova/fator/autoridade ou lançam exceção depois da gravação/auditoria e exigem reversão completa. Dados, histórico e identidade são conferidos; funções temporárias e catálogo restaurados. Resultados e limites ficam em RESULTADO.md, separado do pacote congelado. MFA 068 candidata, main 001–067; sem aceite de produção. Não reiniciar o computador.
