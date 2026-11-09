# Pausa e retomada com MFA: pacote portátil

Sobre [configurações/1.045 fontes](../2026-11-09-configuracoes/README.md), substitui somente `apps/api/test/features-lifecycle.test.ts`. Pai e destino têm **1.045 arquivos**; nenhum produto muda. [Resultado e limites](RESULTADO.md) separados dos arquivos congelados. Restaurar confere somente fontes.

Restaure a cadeia até configurações em uma pasta nova e execute:

```powershell
node --max-old-space-size=128 docs/continuidade/2026-11-09-ciclo-funcionalidades/apply-feature-lifecycle.mjs --candidate CAMINHO_DAS_CONFIGURACOES_1045 --output NOVA_PASTA_DO_CICLO_1045
```

O aplicador confere cinco arquivos internos e todos os arquivos de pai/destino, rejeita destino existente e preserva o pai. Não instala dependências, copia credenciais/caches/node_modules, aplica migrations, inicia serviços ou executa testes. O recibo `API-FEATURE-LIFECYCLE-RESTORE-RECEIPT.json` não é aceite funcional. Prepare ambiente próprio em outro computador. Core85 e pacotes anteriores intactos; imagens e vídeos continuam na main.

A fixture usa administrador e vínculo local fictícios próprios, login/inscrição/TOTP reais e o mesmo bearer/SID. Não altera a conta de demonstração. Preserva os oito casos de negócio e prazos, usando esse ator também no comando de portão previamente enfileirado. Inclui consumo, vagas, comandos concorrentes, entrega durável e suporte remoto. O publicador de equipamento é simulado e o webhook é HTTP local; não demonstra hardware/MQTT externo. MFA068 segue candidata, runtime001–067. Não reiniciar o computador.
