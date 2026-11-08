# Equipes: pacote portátil de fontes

Pacote de 08/11/2026 sobre [concessões/1.036 arquivos](../2026-11-08-concessoes/README.md). O destino tem **1.037 arquivos**. Acrescenta um teste e substitui somente o router tenancy, com proteção MFA no POST de criação/renovação de integrantes. O [resultado funcional](RESULTADO.md) fica separado deste pacote congelado; a restauração abaixo verifica apenas fontes.

## Restaurar

1. Clone a main e leia `docs/CONTINUIDADE.md`.
2. Restaure checkpoint85 → V4 diretamente, sem V3 → obrigatório por flag → vínculo global → revogações → criação → concessões. Use uma pasta nova em cada etapa.
3. Execute sobre o resultado de concessões:

```powershell
node --max-old-space-size=128 docs/continuidade/2026-11-08-equipes/apply-team-renewal.mjs --candidate CAMINHO_DAS_CONCESSOES_1036 --output NOVA_PASTA_DAS_EQUIPES_1037
```

O aplicador confere os seis arquivos internos, o pai e os dois payloads, rejeita destino existente, copia somente fontes e confere os 1.037 arquivos e a preservação do pai ao final. Não instala dependências, copia credenciais/caches/node_modules, aplica migrations, inicia serviços ou executa testes. O recibo `API-TEAM-RENEWAL-RESTORE-RECEIPT.json` não é aceite funcional.

Em outro computador, prepare dependências e ambiente próprios. Não copie URLs privadas ou atestações de contêiner. As fontes de navegador históricas permanecem no inventário, sem serem reexecutadas pelo aplicador; imagens e vídeos continuam em docs da main. Core85 e pacotes anteriores permanecem intactos. A política obrigatória ainda é candidata, sem ativação parcial no runtime principal. Não reiniciar o computador nesta sessão.

## Escopo

O upsert mantém o identificador na renovação, substitui ou limpa datas e conserva o conflito ativo409. A decisão MFA também é consumida quando não há linha retornada. A consulta de morador permanece em statement separado após a escrita; a auditoria é seguida de nova decisão MFA. Esquemas, demais rotas, helpers compartilhados, ACL/policies e migrations não mudaram. As fontes baseline/fixed usam o mesmo teste com 21 casos, e a seleção de regressão tem dez arquivos/147 TAP. Contagens de execução e limites devem ser lidos no resultado.
