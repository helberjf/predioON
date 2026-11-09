# Concessão e revogação de suporte: pacote portátil de fontes

Pacote de 09/11/2026 sobre [remoção da equipe de suporte/1.043 arquivos](../2026-11-08-remocao-suporte/README.md). O destino tem **1.044 arquivos**. Acrescenta um teste e substitui o router de suporte, com proteção MFA nos comandos de concessão/substituição e revogação. O [resultado funcional](RESULTADO.md) é separado deste pacote congelado; restaurar verifica apenas fontes.

## Restaurar

1. Clone a main e leia `docs/CONTINUIDADE.md`.
2. Restaure checkpoint85 → V4 diretamente, sem V3 → obrigatório por flag → vínculo global → revogações → criação → concessões → equipes → convites → criação de usuários → vínculos de usuários → revogação de usuários → cadastro de suporte → remoção de suporte. Use uma pasta nova em cada etapa.
3. Execute sobre o resultado de remoção de suporte:

```powershell
node --max-old-space-size=128 docs/continuidade/2026-11-09-acessos-suporte/apply-support-grant-commands.mjs --candidate CAMINHO_DA_REMOCAO_SUPORTE_1043 --output NOVA_PASTA_DOS_ACESSOS_SUPORTE_1044
```

O aplicador confere seis arquivos internos, o pai e dois payloads, rejeita destino existente, copia somente fontes e verifica os1.044 arquivos e a preservação do pai. Não instala dependências, copia credenciais/caches/node_modules, aplica migrations, inicia serviços ou executa testes. O recibo `API-SUPPORT-GRANT-COMMANDS-RESTORE-RECEIPT.json` não é aceite funcional.

Em outro computador, prepare dependências e ambiente próprios. Não copie URLs privadas ou atestações de contêiner. Fontes de navegador históricas permanecem no inventário, sem reexecução pelo aplicador; imagens e vídeos continuam em docs da main. Core85 e pacotes anteriores intactos. A política obrigatória ainda é candidata, sem ativação parcial no runtime principal. Não reiniciar o computador nesta sessão.

## Escopo

Altera POST grants, DELETE grant e o helper privado de revogação, também usado pela remoção da equipe. Mantém locks, contratos de prazo/relógio, DTO13campos, auditoria e histórico. Revalida MFA após esperas, alterações e auditorias e protege respostas vazias/idempotentes. Os demais handlers, schemas e migrations não mudam.

O teste V2 tem99 casos; seis regressões têm103 TAP/99 casos independentes/quatro grupos. V2 corrige somente o campo currentPassword de uma chamada real de confirmação de senha; produto, asserções e prazos permanecem iguais. Resultados, histórico V1 e limites estão no documento de resultado. Configurações, outros domínios, cache, concorrências adicionais, reconciliação do histórico, matriz web/nativa e operação continuam pendentes.
