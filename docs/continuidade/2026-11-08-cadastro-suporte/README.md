# Cadastro da equipe de suporte: pacote portátil de fontes

Pacote de 08/11/2026 sobre [revogação de usuários/1.041 arquivos](../2026-11-08-revogacao-usuarios/README.md). O destino tem **1.042 arquivos**. Acrescenta um teste e substitui somente o router de suporte, com proteção MFA em `POST /v1/support-access/staff`. O [resultado funcional](RESULTADO.md) é separado deste pacote congelado; restaurar verifica apenas fontes.

## Restaurar

1. Clone a main e leia `docs/CONTINUIDADE.md`.
2. Restaure checkpoint85 → V4 diretamente, sem V3 → obrigatório por flag → vínculo global → revogações → criação → concessões → equipes → convites → criação de usuários → vínculos de usuários → revogação de usuários. Use uma pasta nova em cada etapa.
3. Execute sobre o resultado de revogação de usuários:

```powershell
node --max-old-space-size=128 docs/continuidade/2026-11-08-cadastro-suporte/apply-support-staff-create.mjs --candidate CAMINHO_DA_REVOGACAO_1041 --output NOVA_PASTA_DO_CADASTRO_SUPORTE_1042
```

O aplicador confere seis arquivos internos, o pai e dois payloads, rejeita destino existente, copia somente fontes e confere os 1.042 arquivos e a preservação do pai. Não instala dependências, copia credenciais/caches/node_modules, aplica migrations, inicia serviços ou executa testes. O recibo `API-SUPPORT-STAFF-CREATE-RESTORE-RECEIPT.json` não é aceite funcional.

Em outro computador, prepare dependências e ambiente próprios. Não copie URLs privadas ou atestações de contêiner. Fontes de navegador históricas permanecem no inventário, sem reexecução pelo aplicador; imagens e vídeos continuam em docs da main. Core85 e pacotes anteriores intactos. A política obrigatória ainda é candidata, sem ativação parcial no runtime principal. Não reiniciar o computador nesta sessão.

## Escopo

Consultas da pessoa/duplicidade, INSERT e decisão final após auditoria observam MFA. Preserva verificação recente de senha, permissões, contrato de dados e recusas. Cadastro na equipe não concede acesso a condomínio. Outros handlers, helpers, schemas, ACL/policies e migrations não mudaram. O mesmo teste V2 tem 36 casos em baseline/fixed; quatro regressões têm 32 TAP, com 28 casos independentes e quatro grupos. V2 apenas envia um código de recuperação real na confirmação recente da senha; V1 e sua tentativa permanecem documentados. Resultados e limitações estão no documento de resultado. DELETE da equipe, concessões/revogação de suporte, configurações, cache legado e concorrências adicionais continuam pendentes.
