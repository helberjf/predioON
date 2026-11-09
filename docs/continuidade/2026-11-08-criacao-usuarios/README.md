# Criação de usuários: pacote portátil de fontes

Pacote de 08/11/2026 sobre [convites/1.038 arquivos](../2026-11-08-convites/README.md). O destino tem **1.039 arquivos**. Acrescenta o teste V2 e substitui somente o router de usuários, com proteção MFA em `POST /users`. O [resultado funcional](RESULTADO.md) é separado deste pacote congelado; restaurar verifica apenas fontes.

## Restaurar

1. Clone a main e leia `docs/CONTINUIDADE.md`.
2. Restaure checkpoint85 → V4 diretamente, sem V3 → obrigatório por flag → vínculo global → revogações → criação → concessões → equipes → convites. Use uma pasta nova em cada etapa.
3. Execute sobre o resultado de convites:

```powershell
node --max-old-space-size=128 docs/continuidade/2026-11-08-criacao-usuarios/apply-user-create.mjs --candidate CAMINHO_DOS_CONVITES_1038 --output NOVA_PASTA_DOS_USUARIOS_1039
```

O aplicador confere seis arquivos internos, o pai e dois payloads, rejeita destino existente, copia somente fontes e confere os 1.039 arquivos e a preservação do pai. Não instala dependências, copia credenciais/caches/node_modules, aplica migrations, inicia serviços ou executa testes. O recibo `API-USER-CREATE-RESTORE-RECEIPT.json` não é aceite funcional.

Em outro computador, prepare dependências e ambiente próprios. Não copie URLs privadas ou atestações de contêiner. Fontes de navegador históricas permanecem no inventário, sem reexecução pelo aplicador; imagens e vídeos continuam em docs da main. Core85 e pacotes anteriores intactos. A política obrigatória ainda é candidata, sem ativação parcial no runtime principal. Não reiniciar o computador nesta sessão.

## Escopo

A leitura de duplicidade e o INSERT consomem uma decisão MFA na mesma instrução; a checagem após auditoria exige prova válida para concluir a criação. Mantém capacidade global, confirmação recente, schema, campos públicos, hash de senha e auditoria. Comandos de vínculos, demais handlers, helpers, ACL/policies e migrations não mudaram. O mesmo teste V2 tem21 casos em baseline/fixed; catorze regressões têm213 TAP, com203 casos independentes e dez grupos. Resultados e limitações estão no documento de resultado. A política de cache das rotas legadas continua pendente.
