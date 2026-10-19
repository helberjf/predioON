# Verificação iOS num Mac

`verify.sh` é para rodar num Mac emprestado e gerar um relatório do estado dos apps iOS. Ele faz o seguinte:

1. Confere os pré-requisitos e oferece instalar o que faltar: Xcode selecionado e licenciado, simulador de iOS, Node 24, Ruby 3.3, Python e Git.
2. Instala as dependências (pnpm e CocoaPods) e roda os testes do app, a verificação de tipos e os testes dos scripts.
3. Compila **Morador** e **Operação** para o simulador e abre cada app duas vezes num simulador criado só para isso. Depois confere por OCR que a tela de login apareceu e apaga o simulador.
4. Gera `.local/ios-mac/<data>/report.md`, `report.json` e um `.zip` com tudo.

Opcionalmente, ele também:

- instala os apps no iPhone conectado por cabo (`--device`);
- envia os apps ao TestFlight (`--testflight`);
- publica o relatório numa branch do GitHub (`--publish`).

## Antes de começar

**Quem é dono do repositório (Helber):** adicione o amigo como colaborador em GitHub → Settings → Collaborators. Sem isso ele não consegue clonar o repositório privado nem publicar o relatório. Esse acesso inclui escrita: remova-o depois, se preferir.

**Quem tem o Mac:**

1. Instale o **Xcode** pela App Store e abra-o uma vez.
2. Instale o **Homebrew** seguindo [brew.sh](https://brew.sh). O script usa o Homebrew para instalar o Node e o Ruby, se faltarem.
3. Configure o Git, uma única vez:

   ```bash
   git config --global user.name "Seu Nome"
   git config --global user.email voce@exemplo.com
   ```

4. Clone o repositório e entre na pasta:

   ```bash
   git clone https://github.com/helberjf/predioON.git
   cd predioON
   ```

## Rodar a verificação

```bash
scripts/ios-mac/verify.sh
```

O script pergunta antes de instalar qualquer coisa. Com `--yes`, ele instala sem perguntar. Algumas etapas pedem a senha do Mac (`sudo`), como aceitar a licença do Xcode. Na primeira execução, ele baixa dependências e compila tudo, o que pode levar de 30 a 60 minutos. As execuções seguintes são mais rápidas.

Ao final aparece **APROVADA** ou **REPROVADA**, o caminho do relatório e o `.zip`. Para mandar o resultado:

- **Pelo GitHub:** `scripts/ios-mac/verify.sh --publish`. O relatório vai para a branch `relatorios/ios-mac-<data>`, na pasta `docs/evidencias/ios-mac/<data>/`. Vão as capturas de tela e só o final dos logs que falharam, nunca os logs inteiros.
- **Por e-mail ou WhatsApp:** envie o `.zip` indicado no final.

`--app resident` ou `--app operations` verifica um app só. `--skip-simulator` pula o simulador.

## Instalar no iPhone do Helber pelo cabo (sem conta Apple paga)

Isto exige o iPhone presente, conectado ao Mac. A instalação vale **7 dias**; depois é preciso repetir.

1. No Xcode → Settings → Accounts, adicione um Apple ID. Pode ser gratuito, e pode ser o do Helber.
2. Conecte o iPhone, desbloqueie e toque em **Confiar**. Ative o **Modo de Desenvolvedor** em Ajustes → Privacidade e Segurança, e o iPhone reinicia.
3. A API precisa estar acessível pela internet com HTTPS. Enquanto não há domínio, o Helber pode abrir um túnel no PC dele com a API rodando:

   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```

   O comando mostra um endereço `https://xxxx.trycloudflare.com`.

4. No Mac, rode o script com esse endereço:

   ```bash
   scripts/ios-mac/verify.sh --device --api-url https://xxxx.trycloudflare.com
   ```

5. No iPhone, abra Ajustes → Geral → VPN e Gerenciamento de Dispositivo, confie no desenvolvedor e abra o app.

O script detecta o Team ID sozinho quando o Xcode tem só uma conta. Com mais de uma, ele lista as opções e você escolhe com `--team`. Nessa instalação, o identificador do app ganha o sufixo `.dev` (por exemplo, `com.predioon.resident.dev`). Isso evita que um Apple ID gratuito registre `com.predioon.resident`, que precisa ficar livre para a conta paga do Helber. O script desfaz essa troca no `project.pbxproj` ao terminar.

## Enviar ao TestFlight (conta Apple paga, sem precisar do iPhone por perto)

O Helber instala os apps pelo app **TestFlight**, de onde estiver. Sem um Mac, o mesmo envio pode ser feito pelo EAS (veja `packages/mobile/README.md`). **Escolha um dos dois caminhos e fique nele**: os números de build não podem voltar para trás.

O Helber prepara uma vez:

1. No App Store Connect, crie os apps com os identificadores `com.predioon.resident` e `com.predioon.operations`.
2. Em Users and Access → Integrations → App Store Connect API, crie uma chave de equipe com a função **Admin**. A assinatura automática precisa dessa função para criar o certificado de distribuição. Baixe o arquivo `.p8`; a Apple só permite baixá-lo uma vez.
3. Mande o `.p8`, o Key ID e o Issuer ID ao amigo por um canal privado. **Nunca coloque esses dados no Git.** Revogue a chave quando não precisar mais dela.

O amigo roda:

```bash
ASC_KEY_ID=ABC123XYZ9 ASC_ISSUER_ID=00000000-0000-0000-0000-000000000000 \
ASC_KEY_PATH="$HOME/Downloads/AuthKey_ABC123XYZ9.p8" \
scripts/ios-mac/verify.sh --testflight --team TEAMID --api-url https://api.seu-dominio.com.br
```

O número do build é a data e a hora (por exemplo, `202610181530`); use `--build-number` para fixar outro. Depois do envio, a Apple leva de 10 a 30 minutos para processar. Então o build aparece no TestFlight para os testadores internos.

## O que o script altera no Mac

- Ele grava a URL da API no `config.ts` de cada app só durante o build e restaura o arquivo depois, mesmo se for interrompido. Por isso ele se recusa a rodar se o `config.ts` tiver alterações locais.
- Builds, gems e relatórios ficam em `.local/ios-mac/`, que o Git ignora. Apague a pasta para liberar espaço.
- O CocoaPods gera `ios/Pods`, o `.xcworkspace` e o `Podfile.lock`, como num desenvolvimento normal. A lista de arquivos alterados no checkout aparece no fim do relatório.

## O que esta verificação não cobre

- Login e jornadas com a API real no iOS. Para isso, rode o workflow manual `ios-auth.yml` no GitHub.
- Portão, gateway e outros equipamentos físicos.
- Detalhes visuais. O OCR confere a tela de login, mas alguém precisa olhar as capturas do relatório.
