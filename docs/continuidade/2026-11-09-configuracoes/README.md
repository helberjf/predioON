# Configurações de funcionalidades: pacote portátil de fontes

Pacote de09/11/2026 sobre [acessos de suporte/1.044 arquivos](../2026-11-09-acessos-suporte/README.md). O destino tem **1.045 arquivos**, com um teste novo e o router de funcionalidades atualizado. [Resultado funcional e limites](RESULTADO.md) ficam separados deste pacote congelado; a restauração confere somente fontes.

## Restaurar

1. Clone a main e leia `docs/CONTINUIDADE.md`.
2. Restaure checkpoint85 → V4 diretamente, sem V3 → obrigatório por flag → vínculo global → revogações → criação → concessões → equipes → convites → criação de usuários → vínculos de usuários → revogação de usuários → cadastro de suporte → remoção de suporte → acessos de suporte. Use pasta nova em cada etapa.
3. Aplique sobre o resultado de acessos de suporte:

```powershell
node --max-old-space-size=128 docs/continuidade/2026-11-09-configuracoes/apply-feature-commands.mjs --candidate CAMINHO_DOS_ACESSOS_SUPORTE_1044 --output NOVA_PASTA_DAS_CONFIGURACOES_1045
```

O aplicador confere seis arquivos internos, pai e dois payloads; rejeita destino existente, copia somente fontes e verifica todos os1.045 arquivos, preservando o pai. Não instala dependências, copia credenciais/caches/node_modules, aplica migrations, inicia serviços nem executa testes. O recibo `API-FEATURE-COMMANDS-RESTORE-RECEIPT.json` não é aceite funcional. Prepare ambiente próprio em outro computador; nunca copie URLs privadas ou atestações de contêiner. Imagens e vídeos continuam na main; fontes históricas dos navegadores permanecem no inventário sem reexecução. Core85 e pacotes anteriores intactos. Não reiniciar este computador.

## Escopo

Protege global/local PUT como operação única: decisão MFA/capacidade, leituras, upsert, espera, transições, auditoria, NOTIFY e resposta. Preserva lock exclusivo, versões, herança/dependências, relógios e helper SQL de transição. Compartilha a projeção existente de condomínio sem alterar seu SQL/decodificação. Gravação suprimida falha sem emitir auditoria/aviso falso. Migrations/políticas intactas.

O teste V2 tem72 casos; quatro regressões têm48 TAP/45 casos independentes/três grupos. V1 permanece documentada, incluindo dois erros de restauração da data da permissão e o caso global que já falhava fechado. V2 corrige a restauração exata e a disposição esperada desse caso; produto, verificações HTTP/efeitos e prazos iguais. Política obrigatória068 segue candidata, runtime001–067. Demais domínios, cache, regressão completa de API/ingest, web/nativos e operação/apresentação permanecem pendentes.
