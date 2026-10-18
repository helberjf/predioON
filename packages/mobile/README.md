# Aplicativos móveis Prédio ON

Biblioteca de experiência compartilhada por dois projetos **React Native sem Expo**:

| Aplicativo | Android / iOS | Fluxos deste incremento |
| --- | --- | --- |
| Morador | `com.predioon.resident` | Avisos publicados; solicitações próprias, criação e conversa; criação e cancelamento de reservas; transparência e prestação de contas; solicitação de abertura de portões autorizados |
| Operação | `com.predioon.operations` | Resumo com indicação de cobertura; leituras; alertas e ações autorizadas; acompanhamento de solicitações |

Os aplicativos consultam a API existente, sem dados demonstrativos embutidos. A seleção de condomínio usa `/buildings`; as telas consultam `/v1/authorization` e funcionalidades do condomínio. As permissões são revalidadas pelo servidor em cada chamada. O produto Morador não exibe telas operacionais nem solicitações de terceiros, mesmo quando uma mesma conta possui permissões de gestão. Contas sem os módulos necessários veem uma mensagem de acesso indisponível.

## Instalação e execução

Na raiz do repositório, use Node compatível com RN 0.87.1 (`^22.13.0`, `^24.3.0` ou `>=26`) e a versão de pnpm do `packageManager`:

```sh
pnpm install
pnpm --filter @predioon/resident-mobile start
# Em outro terminal, com o emulador Android disponível:
pnpm --filter @predioon/resident-mobile android --no-packager
```

Para Operação, substitua `resident-mobile` por `operations-mobile`. Execute um Metro por vez ou configure portas distintas. O comando `dev` da plataforma não inicia os aplicativos automaticamente.

Android exige JDK 17 ou posterior compatível com Gradle 9.4.1, Android SDK Platform 37, Build Tools 37.0.0 e NDK 27.1.12297006 conforme o template. Configure `ANDROID_HOME`/`JAVA_HOME`, instale um emulador ou conecte um dispositivo autorizado. O mínimo de execução Android é API 24.

iOS exige um Mac com Xcode compatível, Ruby/Bundler e CocoaPods. No diretório de cada app, execute `bundle install`, depois `cd ios && bundle exec pod install`, abra o workspace gerado ou execute `pnpm ios` no diretório do app. O deployment target do template é iOS 15.1. Sem Mac, o build iOS distribuível passa pelo EAS Build (abaixo); o CI `ios.yml` continua compilando o simulador no macOS do GitHub.

### iOS sem Mac: EAS Build

O Expo entra somente como serviço de build, assinatura e envio do iOS. Os apps não usam o Expo SDK nem o pacote `expo`: nenhuma versão do SDK acompanha o React Native 0.87. O `eas-cli` lê o bloco `expo` do `app.json` e o `eas.json` de cada app. O Android continua no Gradle.

| Perfil | Saída | Conta Apple | Variável `PRODUCTION_API_URL` |
|---|---|---|---|
| `production` | `.ipa` de loja, número de build incrementado pelo EAS | obrigatória | ambiente `production` do EAS |
| `simulator` | `.app` de simulador (Release) para o [Appetize.io](https://appetize.io) | não | ambiente `preview` do EAS |

O hook `eas-build-post-install` executa `scripts/eas-api-origin.mjs`, que grava a origem HTTPS no `config.ts` do checkout do EAS antes do CocoaPods. Sem a variável, ou com algo além de `https://host[:porta]`, o build falha. O `config.ts` versionado continua vazio. Enquanto a API não tiver domínio, o perfil `simulator` pode usar um túnel temporário (`cloudflared tunnel --url http://localhost:3000`). Como a URL do túnel muda a cada execução, cada túnel exige um novo build.

Passos com as suas contas, a partir do diretório de cada app (`resident-mobile` e `operations-mobile`):

1. Inscreva-se no Apple Developer Program (necessário só para o perfil `production`) e crie uma conta Expo.
2. `pnpm dlx eas-cli@24.12.1 login` e `pnpm dlx eas-cli@24.12.1 init`; versione o `projectId` gravado no `app.json`.
3. `pnpm dlx eas-cli@24.12.1 env:set --environment production --name PRODUCTION_API_URL --value https://<origem-da-api> --visibility plaintext` (repita com `--environment preview` para o simulador).
4. `pnpm dlx eas-cli@24.12.1 build -p ios --profile production`. O primeiro build é interativo: você entra com o Apple ID e o EAS cria o certificado e o perfil de distribuição.
5. `pnpm dlx eas-cli@24.12.1 submit -p ios --latest` envia ao TestFlight. Depois do primeiro envio, registre o `ascAppId` informado em `submit.production.ios` do `eas.json`.
6. Para ver no navegador: `pnpm dlx eas-cli@24.12.1 build -p ios --profile simulator`, baixe o `.app` compactado e envie ao Appetize.io.

O `Info.plist` declara `ITSAppUsesNonExemptEncryption = false`: os apps usam apenas a criptografia do sistema (HTTPS e Keychain). Se isso mudar, revise a declaração de exportação. Os ícones iOS atuais são provisórios (1024 px, sem transparência).

O `config.ts` de cada app usa `http://10.0.2.2:3000` no emulador Android e `http://localhost:3000` no simulador iOS em desenvolvimento. Para aparelhos físicos, configure um endereço acessível ao aparelho. Configure **`PRODUCTION_API_URL` com HTTPS** antes de distribuir; uma release sem URL válida mostra uma mensagem e não envia credenciais. Os horários da reserva são explicitamente os do aparelho e enviados como instantes ISO à API.

## Sessão e atualização

- O cliente é `@predioon/api-client`; sua rotação é serializada e resultados de sessões antigas são descartados.
- Apenas o refresh token é persistido com `react-native-keychain`; o access token permanece em memória. Keychain usa `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Produtos e URLs da API usam serviços separados; Android desativa backup do aplicativo.
- As telas ativas atualizam a cada 15 segundos. Ao entrar em segundo plano, a consulta periódica para e os dados visíveis são limpos. A troca de condomínio desmonta telas e formulários anteriores.
- Falhas de transporte não repetem mutações automaticamente. Em caso de resposta perdida, atualize a lista antes de reenviar uma solicitação ou reserva. A API ainda não possui idempotência em todos esses endpoints.
- O logout apaga primeiro as credenciais locais e tenta revogar a sessão remota. Sem conexão, a sessão remota permanece sujeita à política de expiração/revogação do servidor.
- Transparência consulta informes `GESTAO` e prestações publicadas conforme os módulos habilitados, com filtro por mês, revisões e comprovantes HTTPS. O aplicativo não oferece edição financeira. Mesmo uma conta de gestão usando o Morador vê somente publicações nesta tela.
- Acessos solicita confirmação antes de enviar e conserva um UUID seguro por intenção na sessão, inclusive após trocar abas ou condomínio. Falha de transporte não reenvia comandos automaticamente; um reenvio explicitamente confirmado reutiliza o UUID e a idempotência da API. Consultas e retorno ao primeiro plano apenas leem o resultado. O UUID não é uma fila offline e é descartado no logout ou encerramento do processo.
- `SENT` significa envio aguardando resposta; `ACKNOWLEDGED` significa execução reconhecida pelo controlador, sem confirmar a posição física do portão. A API verifica novamente vínculo, módulo, autorização do portão e conexão recente antes de aceitar um novo comando. O app Morador mostra somente portões habilitados para moradores, inclusive quando a conta também possui perfil de gestão.

## Validação e limites deste incremento

```sh
pnpm --filter @predioon/mobile test
pnpm --filter @predioon/mobile --filter @predioon/resident-mobile --filter @predioon/operations-mobile typecheck
pnpm --filter @predioon/resident-mobile exec react-native config
```

Os testes cobrem persistência apenas de refresh, restauração, rotação concorrente, falha temporária, logout, revogação, separação entre públicos, mudança de escopo, funcionalidades, reservas/HTTPS, publicação financeira, idempotência de comandos, respostas fora de ordem e invalidação de intenções ao sair. A geração de bundle Metro verifica resolução de módulos JavaScript; não substitui build nativo nem teste em aparelho.

Ainda exigem implementação/validação: push FCM/APNs e instalações móveis; ordens de serviço e automações quando os módulos da API forem entregues; navegação por concessões restritas a recursos (este incremento solicita capacidades no escopo do condomínio); MFA e identificação da audiência na sessão; ícones finais (os do iOS são provisórios) e publicação nas lojas, incluindo o primeiro build EAS assinado; execução em aparelho e confirmação com controlador físico. As rotas legadas de convivência e acessos ainda dependem dos vínculos aceitos pela API: um novo papel de manutenção não recebe um vínculo legado implicitamente. Não ampliar privilégios no cliente para contornar uma resposta 403.

Os projetos nativos vêm de `@react-native-community/template` **0.87.2**, com React Native **0.87.1**, React **19.2.3** e CLI **20.2.0**. A licença original está em `TEMPLATE-LICENSE` de cada app. Identificadores, Metro para o monorepo e assinatura Android de release foram adaptados. A chave pública de debug do template serve apenas ao desenvolvimento; a release não é assinada com ela. Defina chaves próprias e equipe Apple fora do Git antes da publicação.

Referências oficiais: [React Native sem framework](https://reactnative.dev/docs/getting-started-without-a-framework), [preparação de ambiente](https://reactnative.dev/docs/set-up-your-environment), [React Native Keychain](https://github.com/oblador/react-native-keychain).

## Android neste Windows: o que foi preciso além do SDK

Registrado em 06/10/2026, ao rodar o app Operação num emulador local pela primeira vez. São condições desta máquina; em outra podem não se aplicar.

| Sintoma | Causa | Ajuste |
| --- | --- | --- |
| `PKIX path building failed` ao baixar o Gradle | Antivírus com inspeção HTTPS reassina os certificados com uma raiz que só o Windows conhece | `-Djavax.net.ssl.trustStoreType=Windows-ROOT` (o Java passa a usar o repositório do Windows; nenhuma verificação é desligada) |
| `Unable to establish loopback connection` | O Java 17 cria sockets internos na pasta temporária, e o caminho do perfil deste usuário não serve | `-Djdk.net.unixdomain.tmpdir=C:/ptmp`, com a pasta criada |
| As duas opções não chegam ao daemon do Gradle | Propriedades em `gradle.properties` são aplicadas tarde demais | Definir em `JAVA_TOOL_OPTIONS`, lida por toda JVM |
| `Filename longer than 260 characters` no ninja | Caminho longo do repositório somado ao de `node_modules` | `subst P: <raiz do repositório>` e compilar a partir de `P:`. Uma junção de pasta não resolve: o Gradle a converte de volta |
| Emulador encerra com `Insufficient RAM` ou trava | Memória comprometida no limite (16 GB com Docker e navegador abertos) | `-memory 1536`, fechar programas pesados e não compilar com o emulador aberto |
| Emulador parado sem janela útil | Diálogo pedindo consentimento para enviar o relatório de uma falha anterior | Responder o diálogo, ou apagar `%TEMP%AndroidEmulator` e iniciar com `-no-metrics` |
| `sdkmanager` não acha os pacotes | Foi substituído pelo `android sdk`, com nomes separados por barra | `android sdk install platforms/android-37.0 build-tools/37.0.0 ndk/27.1.12297006 system-images/android-35/google_apis/x86_64` |

| Daemon do Gradle some no meio do C++ (`insufficient memory`) | Memória virtual esgotada | Encerrar processos `java` remanescentes e usar `--max-workers=1` |

Sequência usada: banco descartável e API em `:3000`, um Metro por app (`:8081` para Operação e `:8088` para Morador), `gradlew app:assembleDebug -PreactNativeArchitectures=x86_64 --max-workers=1` — acrescentando `-PreactNativeDevServerPort=8088` no Morador —, emulador e `adb install -r`. Se o app abrir antes do Metro responder, aparece a tela vermelha de bundle; basta reabrir o app. iOS continua exigindo macOS.

