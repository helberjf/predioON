# Remoção da equipe de suporte: pacote portátil de fontes

Pacote de 08/11/2026 sobre [cadastro da equipe de suporte/1.042 arquivos](../2026-11-08-cadastro-suporte/README.md). O destino tem **1.043 arquivos**. Acrescenta um teste e substitui somente o router de suporte, com proteção MFA em `DELETE /v1/support-access/staff/:id`. O [resultado funcional](RESULTADO.md) é separado deste pacote congelado; restaurar verifica apenas fontes.

## Restaurar

1. Clone a main e leia `docs/CONTINUIDADE.md`.
2. Restaure checkpoint85 → V4 diretamente, sem V3 → obrigatório por flag → vínculo global → revogações → criação → concessões → equipes → convites → criação de usuários → vínculos de usuários → revogação de usuários → cadastro de suporte. Use uma pasta nova em cada etapa.
3. Execute sobre o resultado de cadastro de suporte:

```powershell
node --max-old-space-size=128 docs/continuidade/2026-11-08-remocao-suporte/apply-support-staff-remove.mjs --candidate CAMINHO_DO_CADASTRO_SUPORTE_1042 --output NOVA_PASTA_DA_REMOCAO_SUPORTE_1043
```

O aplicador confere seis arquivos internos, o pai e dois payloads, rejeita destino existente, copia somente fontes e confere os 1.043 arquivos e a preservação do pai. Não instala dependências, copia credenciais/caches/node_modules, aplica migrations, inicia serviços ou executa testes. O recibo `API-SUPPORT-STAFF-REMOVE-RESTORE-RECEIPT.json` não é aceite funcional.

Em outro computador, prepare dependências e ambiente próprios. Não copie URLs privadas ou atestações de contêiner. Fontes de navegador históricas permanecem no inventário, sem reexecução pelo aplicador; imagens e vídeos continuam em docs da main. Core85 e pacotes anteriores intactos. A política obrigatória ainda é candidata, sem ativação parcial no runtime principal. Não reiniciar o computador nesta sessão.

## Escopo

Preserva o SELECT FOR UPDATE original, verifica MFA em nova instrução após a espera, protege UPDATE e verifica novamente antes de concluir toda a remoção com suas auditorias e revogações automáticas. O helper compartilhado de revogação e demais handlers continuam iguais. Vínculo já inativo conserva204 sem auditar ou fechar acessos históricos; UPDATE sem linha conserva a recusa da política de auditoria. Não acrescenta confirmação recente de senha. O teste V2 tem35 casos; cinco regressões têm68 TAP,64 casos independentes e quatro grupos. V2 apenas atualiza a observação de estatísticas; produto, verificações e prazos iguais a V1. Resultados e limites estão no documento de resultado. Concessão/substituição/revogação direta de suporte, configurações, cache e concorrências adicionais continuam pendentes.
