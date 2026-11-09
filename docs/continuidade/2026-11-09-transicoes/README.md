# Fontes portáteis: reversão de transições com MFA

Este pacote acrescenta somente um teste de 32 casos ao candidato de 1.045 fontes já restaurado até pausa/retomada. Não ativa MFA obrigatória na main, instala dependências, aplica migrações ou inicia serviços/testes. O inventário final contém 1.046 fontes.

Primeiro restaurar a cadeia de pacotes até `2026-11-09-ciclo-funcionalidades`. Depois executar, com Node.js, indicando uma nova pasta de destino:

```powershell
node ./apply-feature-transition.mjs --candidate <pasta-com-1045-fontes> --output <nova-pasta-com-1046-fontes>
```

O aplicador confere os hashes e tamanhos do pacote, dos 1.045 arquivos do pai e dos 1.046 arquivos de destino. Nenhum arquivo antigo do pai é alterado. Copia somente fontes declaradas, sem credenciais, arquivos de ambiente, dependências, caches ou compilações. Recibo `API-FEATURE-TRANSITION-RESTORE-RECEIPT.json` distingue restauração de fontes de execução funcional.

Os 32 casos abrangem dois escopos, quatro efeitos reais e retirada de prova/fator/vínculo global ou exceção. O teste usa autenticação HTTP real e um banco temporário; os registros imutáveis da fila são removidos com esse banco. Asserções e limites devem ser consultados junto ao resultado funcional publicado separadamente. Este pacote, sozinho, não comprova aprovação dos testes nem produção.
