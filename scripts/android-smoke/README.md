# Smoke Android dos aplicativos

O workflow [android-smoke.yml](../../.github/workflows/android-smoke.yml) verifica o início de execução dos dois produtos em emulador Android API 35, arquitetura x86_64. A existência do workflow não constitui evidência de aprovação: conferir o resultado de cada app e os artefatos do respectivo commit.

## O que é executado

1. Instala as dependências fixadas no lockfile e executa os testes do próprio verificador.
2. Na cópia descartável do checkout do CI, troca apenas o literal de API de cada app por `https://smoke-api.invalid`. Esse domínio reservado não representa um backend; o teste não envia login.
3. Compila o mesmo código do app em modo release, com Hermes/JavaScript incorporados e bibliotecas x86_64. O workflow de compilação Android existente continua responsável pelo APK arm64. Um APK arm64 não é tratado como evidência de execução no emulador x86_64.
4. Assina uma cópia do APK com chave temporária de um dia, criada exclusivamente no runner e removida após a assinatura. Não usa identidade de publicação nem secrets de loja. Confere o pacote, modo release e ABI antes de instalar.
5. Inicia um emulador novo, instala o app, limpa somente seus dados de teste e abre a activity.
6. Confere título próprio do produto, campos nativos e botão desabilitado; preenche e-mail fictício, confere que a senha ainda é necessária; preenche a senha fictícia e confere o botão habilitado. O botão de envio não é pressionado.
7. Sai para Home, retoma o formulário e confere seu estado. Encerra apenas o processo do app, inicia novamente e exige formulário sem credenciais preenchidas.
8. Falha se a tela esperada não aparece, se o processo para, se Android registra crash/ANR ou se o estado dos controles contradiz a interação.

O script exige `ro.kernel.qemu=1` antes de instalar ou limpar dados; não deve ser apontado a aparelho físico. Não chama reboot do emulador nem do computador. Os comandos de instalação, activity e captura seguem as ferramentas [ADB](https://developer.android.com/tools/adb) e [apksigner](https://developer.android.com/tools/apksigner). O ciclo de vida do emulador no CI usa o [android-emulator-runner](https://github.com/ReactiveCircus/android-emulator-runner).

## Evidência produzida

Cada job preserva `build.json` com commit, produto, ABI, SHA-256 do APK e resultado de verificação da assinatura. Em `evidence/`, `result.json` registra cada fase aprovada e o erro final, se houver. Capturas PNG e XML mostram o estado observado; `logcat.txt`, `crash.txt`, `exit-info.txt` e `activities.txt` ajudam a investigar falhas. Os artefatos são retidos por sete dias. Se o build falhar antes de instalar, não haverá evidência de runtime; uma ausência de artefatos não conta como sucesso.

O workflow tem jobs independentes para Morador e Operação. Só considerar esse smoke aprovado quando ambos concluírem com sucesso no commit em análise. A assinatura temporária não transforma o APK em distribuição oficial; o workflow publica apenas as evidências, não o APK.

## Limites

Este smoke valida startup nativo, carregamento do bundle, montagem da tela de entrada e operações de formulário/ciclo de vida sem autenticação. Não valida login, renovação de sessão persistida, telas autenticadas, notificações, autorização dos domínios, atendimento offline, loja, iOS, dispositivo físico ou controlador de portão. A API e seus testes continuam separados. Testes unitários Python do verificador também não substituem a execução em emulador.

Uma evolução para E2E autenticado precisa de API/banco isolados, transporte HTTPS confiável para o emulador, contas fictícias, limpeza verificável e contratos estáveis. Não se deve enfraquecer a política HTTPS da release, usar credenciais reais ou tratar uma resposta simulada como prova do backend.

## Verificação local dos scripts

Somente Python padrão, sem instalar bibliotecas:

```powershell
python -m unittest discover -s scripts/android-smoke -p "test_*.py" -v
```

Para executar o smoke é necessário SDK/ADB, um emulador descartável API 35 totalmente inicializado e um APK release x86_64 já preparado/assinado. Não iniciar esse comando sobre instalação com dados necessários:

```bash
python3 scripts/android-smoke/run.py --serial emulator-5554 --app resident-mobile --apk verification.apk --artifacts .local/android-smoke/manual
```

O adaptador `prepare.py configure` só aceita execução com `CI=true` no checkout descartável. Ele não altera a política de URL do cliente nem grava configuração de produção no repositório.
