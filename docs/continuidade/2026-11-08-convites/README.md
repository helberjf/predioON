# Convites: pacote portátil de fontes

Pacote de 08/11/2026 sobre [equipes/1.037 arquivos](../2026-11-08-equipes/README.md). O destino tem **1.038 arquivos**. Acrescenta o teste V3 e substitui somente o router tenancy, com proteção MFA nos comandos de convites. O [resultado funcional](RESULTADO.md) é separado deste pacote congelado; restaurar verifica apenas fontes.

## Restaurar

1. Clone a main e leia `docs/CONTINUIDADE.md`.
2. Restaure checkpoint85 → V4 diretamente, sem V3 → obrigatório por flag → vínculo global → revogações → criação → concessões → equipes. Use uma pasta nova em cada etapa.
3. Execute sobre o resultado de equipes:

```powershell
node --max-old-space-size=128 docs/continuidade/2026-11-08-convites/apply-invitation-commands.mjs --candidate CAMINHO_DAS_EQUIPES_1037 --output NOVA_PASTA_DOS_CONVITES_1038
```

O aplicador confere seis arquivos internos, o pai e dois payloads, rejeita destino existente, copia somente fontes e confere os 1.038 arquivos e a preservação do pai. Não instala dependências, copia credenciais/caches/node_modules, aplica migrations, inicia serviços ou executa testes. O recibo `API-INVITATION-COMMANDS-RESTORE-RECEIPT.json` não é aceite funcional.

Em outro computador, prepare dependências e ambiente próprios. Não copie URLs privadas ou atestações de contêiner. Fontes de navegador históricas permanecem no inventário, sem reexecução pelo aplicador; imagens e vídeos continuam em docs da main. Core85 e pacotes anteriores intactos. A política obrigatória ainda é candidata, sem ativação parcial no runtime principal. Não reiniciar o computador nesta sessão.

## Escopo

Criação, substituição do convite anterior e revogação consomem uma decisão MFA, inclusive quando a alteração não retorna linha. DTO, tokens, regras de escopo, idempotência, histórico, auditoria e e-mail após commit permanecem. Os comandos da substituição continuam separados; DELETE não usa lock que oculte registros fechados. Schemas, outras rotas, helpers compartilhados, ACL/policies e migrations não mudaram. O mesmo teste V3 tem 31 casos em baseline/fixed; doze regressões têm 177 TAP, com 167 casos independentes e dez grupos. Resultados e limitações estão no documento de resultado.
