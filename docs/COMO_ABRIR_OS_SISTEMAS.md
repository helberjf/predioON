# Como abrir os sistemas do Prédio ON

Atualizado em 05/11/2026. Este guia reúne os pontos de entrada existentes. A
validação final de abertura web e nativa na versão de encerramento continua
pendente; consulte [CONTINUIDADE.md](CONTINUIDADE.md). Não é necessário reiniciar
o computador. Nesta sessão, não reiniciar computador, Docker ou WSL.

## Escolha o ambiente antes de executar

| Objetivo | Ponto de entrada | Dados e serviços |
| --- | --- | --- |
| Retomar desenvolvimento local preparado | `scripts/start-local.ps1` | Infraestrutura local e banco configurado no projeto; confere o histórico sem aplicar migrations por padrão. |
| Preparar uma instalação local revisada | `scripts/start-local.ps1 -Setup` | Instala dependências e prepara banco/runtime; não é um comando neutro de visualização. |
| Demonstrar com dados fictícios novos | `scripts/start-local.ps1 -Setup -SeedDemo` | Apenas laboratório descartável: seed redefine senhas demo. |
| Registrar jornadas e testar web | `pnpm.cmd e2e:db up`, depois `pnpm.cmd e2e:record` | Ambiente descartável de QA; portas e contas separadas. |
| Abrir app nativo | Scripts `start`, `android` ou `ios` do respectivo app | Exige ferramentas e dispositivo/simulador próprios; não é iniciado por `pnpm dev`. |
| Rever imagens já salvas | [Galeria](IMAGENS_DOS_SISTEMAS.md) | Não inicia uma aplicação nem comprova que um servidor está ativo. |

Abra o terminal **na raiz do repositório**, onde estão `package.json` e
`pnpm-lock.yaml`. Use a versão de pnpm declarada em `packageManager` (10.17.1
neste checkpoint), Node compatível com o monorepo e Docker Compose para o banco
e o broker locais. Confira os requisitos com `node scripts/check-environment.mjs`.
Não mostre `.env` ou credenciais durante uma apresentação.

## Portais web e API no desenvolvimento local

Em ambiente já preparado, no PowerShell 7 deste computador:

```powershell
pwsh -NoLogo -NoProfile -File .\scripts\start-local.ps1
```

O launcher verifica ferramentas, ambiente, infraestrutura e migrations antes de
iniciar os processos. Ele conserva o `.env` existente e exige o ambiente restrito
da ingestão. Uma divergência de histórico interrompe a abertura: consulte
[MIGRATIONS.md](MIGRATIONS.md) antes de escolher uma atualização. Não usar reset
ou seed como solução para uma falha de inicialização.

Quando os serviços informarem que estão prontos, abra:

| Sistema | Endereço padrão |
| --- | --- |
| Administração | [localhost:5173](http://localhost:5173) |
| Condomínio | [localhost:5174](http://localhost:5174) |
| Morador | [localhost:5175](http://localhost:5175) |
| API: verificação de disponibilidade | [localhost:3000/health](http://localhost:3000/health) |

Esses links não iniciam os serviços. Uma resposta de health também não substitui
login, autorização e uma jornada persistida na API. Não abrir o `index.html`
dos portais diretamente no disco.

**Situação deste Windows em 05/11:** a tentativa de executar o ensaio do launcher
com `powershell.exe` (Windows PowerShell) foi recusada antes do primeiro caso
pela política de execução desse host.
[Registro da tentativa](evidencias/launcher-preflight-2026-11-05.json).
No PowerShell 7.6.5 já instalado, configurado com `RemoteSigned`, o mesmo ensaio
passou **8/8**, sem alterar política ou iniciar serviços reais.
[Prova e limites](evidencias/launcher-behavior-pwsh7-2026-11-05.json).
São testes com ferramentas simuladas: a abertura real e a resolução do pnpm
instalado ainda precisam ser verificadas. Não interpretar o PASS como login
ou integração de banco, navegador e aplicativos aprovados.

`pnpm.cmd dev` é o script existente para iniciar os processos de desenvolvimento
em um ambiente que **já tenha sido preparado e conferido**. Ele não substitui
as verificações de infraestrutura/migrations do launcher. Se o ambiente ainda
não está preparado, siga [DATABASE_SETUP.md](DATABASE_SETUP.md) e o fluxo de
setup revisado; não execute comandos de criação contra uma instalação real
apenas para visualizar as telas.

## Android: Morador e Operação

Os dois apps usam a mesma API, mas são produtos nativos separados. Configure JDK,
Android SDK e o destino conforme [packages/mobile/README.md](../packages/mobile/README.md).
Com a API disponível e um destino Android autorizado, abra um app por vez:

```powershell
pnpm.cmd --filter @predioon/resident-mobile start
```

Em outro terminal na raiz:

```powershell
pnpm.cmd --filter @predioon/resident-mobile android --no-packager
```

Para Operação, substitua `resident-mobile` por `operations-mobile` nos dois
comandos. Encerre o Metro anterior antes de reutilizar sua porta ou configure
portas separadas de forma explícita. Com mais de um dispositivo conectado,
selecione o destino pelas opções suportadas pela CLI instalada; não aceite uma
instalação em aparelho escolhido implicitamente.

Em desenvolvimento, o emulador Android usa `http://10.0.2.2:3000` para chegar à
API do computador. Um aparelho físico precisa de uma origem acessível a ele.
Uma release exige a origem HTTPS configurada e não deve usar credenciais reais
em ambiente de demonstração. Build, instalação, login, segundo plano e câmera
são verificações distintas; a página Morador responsiva não substitui essas provas.

## iOS: execução no Mac

O Windows não executa o simulador iOS. No Mac, instale os pré-requisitos e use
as instruções específicas de [scripts/ios-mac/README.md](../scripts/ios-mac/README.md)
e do [guia mobile](../packages/mobile/README.md). O script `verify.sh` tem modos
e operações próprios: leia os argumentos antes de executá-lo, especialmente
quando houver aparelho físico ou distribuição.

O fluxo local de cada projeto prepara Bundler/CocoaPods no diretório do app,
inicia o Metro e usa seu script `ios`. Um build remoto ou uma gravação anterior
não equivale a abrir a versão atual no iPhone. Assinatura, conta Apple e eventual
distribuição ficam separadas da visualização local. Nunca colocar chaves no Git.

## Playwright e Codegen para a apresentação final

Use o [guia E2E](../e2e/README.md) para instalar os navegadores e preparar a
fixture isolada. O script `scripts/e2e-record.mjs` já abre o Inspector e cria
uma conta de demonstração própria. Exemplos, após preparar a QA:

```powershell
pnpm.cmd e2e:record
pnpm.cmd e2e:record morador
pnpm.cmd e2e:record admin
pnpm.cmd e2e:record anonimo resident
```

Execute **um comando por vez**. O padrão grava o síndico no portal do condomínio.
O perfil anônimo permite registrar entrada e login sem ocultar esses passos.
No Inspector, ative Record e acrescente verificações visuais. Ao terminar,
revise o código gerado, retire dados sensíveis e converta-o em testes com dados
isolados e assertivas de API e de tela. O bruto em `e2e/recorded` não é executado
automaticamente pela suíte. Codegen não é uma gravação de vídeo.

Nesse ambiente, API e portais usam por padrão 3100 e 5273–5275, separados das
portas de desenvolvimento. `E2E_PORT_OFFSET` desloca as portas conforme a
configuração. O Playwright recusa servidores existentes; não encerrar processos
desconhecidos para liberar uma porta. Verifique a disponibilidade de memória
antes de iniciar: esta máquina exige 4 GB livres para a suíte completa e 2 GB
para os ensaios isolados de navegador previstos no plano.

Ao validar a composição candidata de MFA, execute cadastro/confirmação/desafio
pela interface real. Não fabricar uma prova de MFA no banco para simplificar
a apresentação. Não publicar token, estado de sessão, QR de segredo TOTP ou
códigos de recuperação junto das imagens ou do código gravado.

## Encerrar e resolver falhas

- Use Ctrl+C nos terminais dos processos que você iniciou e feche o Inspector
  ao encerrar a gravação. Infraestrutura Docker pode permanecer ativa; confira
  o projeto e os contêineres antes de decidir pará-la.
- Porta ocupada: identifique o proprietário ou configure outra porta. Não
  encerre serviços de outro projeto automaticamente.
- Login recusado: confira o ambiente, o perfil e a resposta da API. Não reexecute
  seed para redefinir uma senha de instalação existente.
- Tela sem dados: confira condomínio, concessão, funcionalidade e origem das
  leituras. Uma tela vazia autorizada pode ser o estado correto.
- App sem API: confira a origem correspondente ao emulador/aparelho e a
  conectividade; não desabilite validações de TLS para contornar a falha.
- Memória insuficiente: mantenha apenas os processos necessários à rodada e
  aguarde capacidade. Não reinicie computador, Docker ou WSL nesta sessão.

Para explicar o projeto enquanto navega, use [ROTEIRO_ENTREVISTA.md](ROTEIRO_ENTREVISTA.md).
Os scripts existentes serão aceitos como entrega final somente após execução
observada na fonte final e registro dos resultados de web, Android e iOS.
