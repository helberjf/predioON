# Vínculos de usuários: pacote portátil de fontes

Pacote de 08/11/2026 sobre [criação de usuários/1.039 arquivos](../2026-11-08-criacao-usuarios/README.md). O destino tem **1.040 arquivos**. Acrescenta o teste V2 e substitui somente o router de usuários, com proteção MFA em `POST /users/memberships`. O [resultado funcional](RESULTADO.md) é separado deste pacote congelado; restaurar verifica apenas fontes.

## Restaurar

1. Clone a main e leia `docs/CONTINUIDADE.md`.
2. Restaure checkpoint85 → V4 diretamente, sem V3 → obrigatório por flag → vínculo global → revogações → criação → concessões → equipes → convites → criação de usuários. Use uma pasta nova em cada etapa.
3. Execute sobre o resultado de criação de usuários:

```powershell
node --max-old-space-size=128 docs/continuidade/2026-11-08-vinculos-usuarios/apply-user-membership.mjs --candidate CAMINHO_DOS_USUARIOS_1039 --output NOVA_PASTA_DOS_VINCULOS_1040
```

O aplicador confere seis arquivos internos, o pai e dois payloads, rejeita destino existente, copia somente fontes e confere os 1.040 arquivos e a preservação do pai. Não instala dependências, copia credenciais/caches/node_modules, aplica migrations, inicia serviços ou executa testes. O recibo `API-USER-MEMBERSHIP-RESTORE-RECEIPT.json` não é aceite funcional.

Em outro computador, prepare dependências e ambiente próprios. Não copie URLs privadas ou atestações de contêiner. Fontes de navegador históricas permanecem no inventário, sem reexecução pelo aplicador; imagens e vídeos continuam em docs da main. Core85 e pacotes anteriores intactos. A política obrigatória ainda é candidata, sem ativação parcial no runtime principal. Não reiniciar o computador nesta sessão.

## Escopo

O INSERT/ON CONFLICT consome uma decisão MFA materializada na mesma instrução; uma checagem após auditoria exige prova válida para concluir. Mantém autorização global/local, confirmação recente para conceder BUILDING_ADMIN, DTO de dez campos, identidade e data de criação, janelas vigentes/futuras, readmissão e auditoria. DELETE e outros handlers, helpers, schemas, ACL/policies e migrations não mudaram. O mesmo teste V2 tem 34 casos em baseline/fixed; quinze regressões têm 234 TAP, com 224 casos independentes e dez grupos. Resultados e limitações estão no documento de resultado. Cache legado, autorrevogação e concorrências adicionais continuam pendentes.
