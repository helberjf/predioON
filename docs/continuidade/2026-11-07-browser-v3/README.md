# Overlay portátil: três casos de navegador real

Este pacote contém **cinco payloads de QA**, não uma distribuição de produção.
Primeiro restaure o checkpoint existente de85 payloads de MFA/comandos de
estrutura: ele produz1028 arquivos de fonte e cinco suportes separados. O
resultado precisa corresponder exatamente ao inventário parent deste pacote,
associado ao prepared `b4fee359b97e9f37dd7c41ffc19f8264b4bfe1d66357b859692ddd51967cba76`.

Depois, em Node compatível com o projeto, aplique o overlay para uma pasta
**nova**, cujo diretório pai já exista:

```text
node apply-browser-qa.mjs --candidate ../candidato-restaurado-1028 --output ../qa-browser-1031
```

O comando verifica os1028 hashes do candidato e os cinco payloads antes de
escrever, copia somente os arquivos inventariados, aplica os overlays e compara
os1031 hashes finais ao staging V3 preparado por root. Emite
`BROWSER-QA-RESTORE-RECEIPT.json`. Não sobrescreve tentativas, instala dependências,
aplica migrations, inicia serviços ou executa testes. Não copia dotenv,
node_modules, caches, dist, vídeos, screenshots ou os cinco suportes do pacote
anterior; eles não pertencem ao inventário de fonte1031 desta aplicação.

Os arquivos alterados são somente:

- Helper de fixture: o alias administrativo descartável usado para preparar
  dados confirma MFA verdadeira por senha/enroll/TOTP na mesma sessão.
- Spec MFA: abre o diálogo central, confere retenção dos códigos e fechamento
  após “Já guardei os códigos”; conserva as verificações de senha errada, código
  inválido, recuperação, reutilização recusada e desativação.
- Config de Playwright para API+portal do condomínio, um Chromium e zero retries.
- Guard de memória e listeners executado depois de API/preview estarem prontos.
- Entry de API QA em loopback, mantendo o app, a conferência das roles restritas
  e o barramento de eventos do servidor original.

Os dois testes de cadastros permanecem intactos. A seleção contém exatamente
**três casos**: dois em `e2e/specs/tenancy/tenancy-edit.spec.ts` e um em
`e2e/specs/auth/mfa.spec.ts`. Runtime, políticas e demais fontes do candidato
permanecem iguais. A política068 continua candidata; este pacote não a ativa
na main nem comprova a inicialização do entrypoint produtivo.

## Dependências e execução são fases separadas

O pacote é portátil de fontes: não fornece links Windows, caminhos absolutos de
máquina ou credenciais. Prepare as dependências conforme o lockfile e as
instruções do repositório, em uma etapa própria. Os pacotes de workspace
UI/api-client/contracts/shared/db devem resolver o `src` desta nova pasta,
sem links para um checkout antigo ou dist/cache reaproveitados.

Antes de executar, root deve refazer os tipos E2E/portal, a listagem dos três
casos e um build novo e serial do portal. O projeto usa Playwright1.63.0 e os
navegadores correspondentes. A implementação atual do guard de listeners é
Windows: em outra plataforma é necessária uma revisão explícita desse guard,
sem simplesmente desabilitá-lo. A restauração de fontes em si não depende dele.

A execução original deste recorte usa `NODE_ENV=test`,
`E2E_TENANCY_CANDIDATE=1`, `E2E_PORT_OFFSET=1700`, API4800 e preview6974,
ambos em127.0.0.1. Precisa de URLs explícitas para um banco UUID descartável,
roles restritas e seed fictício preparados pela fixture oficial runtime-services.
O owner é de setup/fixture; a API usa APP/IDENTITY/BROKER_AUTH. Manter Resend
desligado, chaves fictícias de QA e logs sem credenciais. Não usar produção.

O guard é2048MiB antes de cada fase e novamente após iniciar API/preview;
a matriz completa conserva4096MiB. Não há retry automático. A operação deve
preservar tentativas e comprovar filhos diretos registrados encerrados e portas
dedicadas fechadas antes do cleanup, sem alegar um censo de descendentes Chromium.
Conferir também remoção da base temporária, restauração de roles/settings,
catálogo e hashes de fonte.

Screenshot e vídeo1280x800 estão ligados, trace desligado. Os clipes representam
três casos de QA, não uma demonstração completa do produto. **Não publicar o
vídeo bruto de MFA**, que contém chave e códigos de recuperação. Somente a
captura final sem esses dados e clipes de cadastro revisados visualmente por
root podem ser selecionados para documentação.

`MANIFEST.json` e `PACKAGE-HASHES.json` contêm apenas caminhos relativos e pins
de integridade. A receipt confirma cópia/comparação de fontes, nunca resultados
de testes, aceite Android/iOS ou prontidão de produção. A autoria deste pacote
não executou o aplicador nem iniciou serviços.
