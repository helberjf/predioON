# Aplicativos móveis Prédio ON

Biblioteca de experiência compartilhada por dois projetos **React Native sem Expo**:

| Aplicativo | Android / iOS | Fluxos deste incremento |
| --- | --- | --- |
| Morador | `com.predioon.resident` | Avisos publicados; solicitações próprias, criação e conversa; criação e cancelamento de reservas |
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

iOS exige um Mac com Xcode compatível, Ruby/Bundler e CocoaPods. No diretório de cada app, execute `bundle install`, depois `cd ios && bundle exec pod install`, abra o workspace gerado ou execute `pnpm ios` no diretório do app. O deployment target do template é iOS 15.1. Builds, assinaturas e execução iOS não podem ser validados neste computador Windows.

O `config.ts` de cada app usa `http://10.0.2.2:3000` no emulador Android e `http://localhost:3000` no simulador iOS em desenvolvimento. Para aparelhos físicos, configure um endereço acessível ao aparelho. Configure **`PRODUCTION_API_URL` com HTTPS** antes de distribuir; uma release sem URL válida mostra uma mensagem e não envia credenciais. Os horários da reserva são explicitamente os do aparelho e enviados como instantes ISO à API.

## Sessão e atualização

- O cliente é `@predioon/api-client`; sua rotação é serializada e resultados de sessões antigas são descartados.
- Apenas o refresh token é persistido com `react-native-keychain`; o access token permanece em memória. Keychain usa `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Produtos e URLs da API usam serviços separados; Android desativa backup do aplicativo.
- As telas ativas atualizam a cada 15 segundos. Ao entrar em segundo plano, a consulta periódica para e os dados visíveis são limpos. A troca de condomínio desmonta telas e formulários anteriores.
- Falhas de transporte não repetem mutações automaticamente. Em caso de resposta perdida, atualize a lista antes de reenviar uma solicitação ou reserva. A API ainda não possui idempotência em todos esses endpoints.
- O logout apaga primeiro as credenciais locais e tenta revogar a sessão remota. Sem conexão, a sessão remota permanece sujeita à política de expiração/revogação do servidor.

## Validação e limites deste incremento

```sh
pnpm --filter @predioon/mobile test
pnpm --filter @predioon/mobile --filter @predioon/resident-mobile --filter @predioon/operations-mobile typecheck
pnpm --filter @predioon/resident-mobile exec react-native config
```

Os testes cobrem persistência apenas de refresh, restauração, rotação concorrente, falha temporária, logout, revogação, separação entre públicos, mudança de escopo, funcionalidades e validação de reservas/HTTPS. A geração de bundle Metro verifica resolução de módulos JavaScript; não substitui build nativo nem teste em aparelho.

Ainda exigem implementação/validação: push FCM/APNs e instalações móveis; ordens de serviço e automações quando os módulos da API forem entregues; transparência/acessos no app Morador; navegação por concessões restritas a recursos (este incremento solicita capacidades no escopo do condomínio); MFA e identificação da audiência na sessão; ícones finais e publicação nas lojas. As rotas legadas de convivência ainda dependem dos vínculos aceitos pela API: um novo papel de manutenção não recebe um vínculo legado implicitamente. Não ampliar privilégios no cliente para contornar uma resposta 403.

Os projetos nativos vêm de `@react-native-community/template` **0.87.2**, com React Native **0.87.1**, React **19.2.3** e CLI **20.2.0**. A licença original está em `TEMPLATE-LICENSE` de cada app. Identificadores, Metro para o monorepo e assinatura Android de release foram adaptados. A chave pública de debug do template serve apenas ao desenvolvimento; a release não é assinada com ela. Defina chaves próprias e equipe Apple fora do Git antes da publicação.

Referências oficiais: [React Native sem framework](https://reactnative.dev/docs/getting-started-without-a-framework), [preparação de ambiente](https://reactnative.dev/docs/set-up-your-environment), [React Native Keychain](https://github.com/oblador/react-native-keychain).
