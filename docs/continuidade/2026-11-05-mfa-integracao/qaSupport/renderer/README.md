# Renderer V6: preparação explícita

O restaurador copia os dois testes para `qa/render-v6/test/` e este suporte para
`qaSupport/renderer/`. Nenhum deles entra automaticamente nos globs API/mobile.
O suporte preserva `type: module`, JSX `react-jsx`, resolução Bundler, lista fechada
dos 37 arquivos necessários e os manifests reais ui/api-client/contracts, incluindo
seus imports `#web-session-coordinator`, `#verification-state`, `#engine`, `#errors`
e `#web-client`. Os testes esperam `test/` ao lado de `packages/` na árvore de QA.

Use um checkout de dependências já instalado com o lock conferido, sem instalar
pacotes novos. O preparador cria uma cópia externa e verifica React/renderer 19.2.3,
react-is 19.3.0, scheduler 0.27.0, tsx 4.23.13, esbuild 0.28.2 e seu pacote nativo.
Lucide 0.468.0 é copiado pelo CJS com SHA exato e entry mínimo, para resolver o mesmo
React da QA. Nenhum caminho absoluto de cache da máquina original é necessário.

```text
node --max-old-space-size=128 qaSupport/renderer/prepare-renderer.mjs --restored-source FONTE_RESTAURADA --dependency-checkout CHECKOUT_COM_DEPS --output NOVA_QA_EXTERNA
```

Esse comando não executa testes. Após autorização de memória/tempo, use o comando
gravado em `RENDER-STAGING.json` no diretório de QA, serialmente, com deadline externo
de 60 segundos, heap 384 MiB e timeout Node de 10 segundos por arquivo. São quatro
cenários dos componentes reais; dependências/browser primitives são as mesmas do
harness V6. React 19.2.3 difere do React web 19.3.0: não transfira a evidência para
DOM, layout, acessibilidade, dispositivo ou browser de produção.
