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

## Execução conferida

Em 02/10/2026 (UTC), a [execução 36959231805](https://github.com/helberjf/predioON/actions/runs/36959231805) concluiu com sucesso no commit `922bd8ec0850174bf6e32232afd87f5382c71000`:

| Produto | Job | Resultado observado |
| --- | --- | --- |
| Morador | [110688976102](https://github.com/helberjf/predioON/actions/runs/36959231805/job/110688976102) | Cinco fases aprovadas; XML e capturas conferidos; buffer de crash vazio. |
| Operação | [110688975799](https://github.com/helberjf/predioON/actions/runs/36959231805/job/110688975799) | Cinco fases aprovadas; XML e capturas conferidos; buffer de crash vazio. |

Nos dois apps, o histórico de saída contém somente o encerramento solicitado pelo próprio teste (`FORCE STOP`). Os artefatos `android-smoke-resident-mobile-36959231805` e `android-smoke-operations-mobile-36959231805` registram os hashes dos APKs, as fases e os diagnósticos. Essa aprovação pertence ao commit citado: mudanças posteriores, inclusive no transporte HTTP, exigem sua própria execução. Não foi realizado login nem contato com uma API nesse teste.

## Transporte HTTP e evidência separada

O commit `63a7179` acrescenta `packages/mobile/src/bounded-fetch.ts`. O limite de 20 segundos acompanha os cabeçalhos e a leitura completa de uma cópia do corpo da resposta; o cliente recebe a `Response` original, mantendo status, headers, URL final, informação de redirecionamento e corpo ainda não consumido. Cancelamento do chamador é propagado, temporizadores/listeners são removidos ao concluir e o chamador deixa de aguardar mesmo se o transporte nativo ignorar o sinal de abort. O adaptador atende respostas finitas da API JSON; não é destinado a streaming ou downloads.

Os sete testes novos verificam corpo interrompido sem repetir um POST de portão, transporte que ignora abort, cancelamento externo, Request já cancelada, preservação da resposta e limpeza do prazo, resposta 204/JSON inválido e redirecionamento HTTP real. Foram aprovados localmente com Node 24, junto da suíte mobile de 42 testes, typechecks do pacote e dos dois apps, bundles Metro Android e fronteiras da arquitetura. A reprodução de corpo incompleto usa o contrato padrão Fetch; o React Native atual usa um adaptador XHR que normalmente já recebe o corpo da rede antes de resolver. Esses testes locais não comprovam transporte autenticado no emulador, e o primeiro smoke citado acima é anterior a essa mudança.

A revisão cruzada acrescentou uma oitava regressão: `init.signal: undefined` herda o sinal da `Request`, enquanto `null` o remove explicitamente. O teste falhou antes da correção e passou depois; a suíte mobile passou a 43 testes aprovados, com typecheck aprovado. Esse detalhe de contrato também precisa acompanhar as próximas verificações de runtime.

## Limites

Este smoke valida startup nativo, carregamento do bundle, montagem da tela de entrada e operações de formulário/ciclo de vida sem autenticação. Não valida login, renovação de sessão persistida, telas autenticadas, notificações, autorização dos domínios, atendimento offline, loja, iOS, dispositivo físico ou controlador de portão. A API e seus testes continuam separados. Testes unitários Python do verificador também não substituem a execução em emulador.

Uma evolução para E2E autenticado precisa de API/banco isolados, transporte HTTPS confiável para o emulador, contas fictícias, limpeza verificável e contratos estáveis. Não se deve enfraquecer a política HTTPS da release, usar credenciais reais ou tratar uma resposta simulada como prova do backend.

## Próximos testes nativos autenticados

Os cenários abaixo ainda não foram executados por este workflow. A ordem prioriza sessão e isolamento antes das ações dos módulos:

1. **Preparar backend isolado:** criar banco descartável pelas migrations oficiais, aplicar identidades fictícias de dois condomínios e servir a API real por HTTPS. A conexão deve validar o certificado: usar ambiente de teste com domínio válido ou uma CA efêmera confiada somente pelo APK de verificação. Não habilitar `trust-all`, HTTP na release ou certificados de teste na distribuição. O broker deve ser isolado de equipamentos reais.
2. **Autenticar e restaurar sessão:** entrar com cada produto, conferir identidade e condomínio, encerrar o processo e abrir novamente. A API deve confirmar uma rotação válida do refresh token; credenciais inválidas, revogadas e falhas transitórias devem apresentar estados diferentes. Conferir logout, novo login e ausência de compartilhamento entre os dois apps. Remover senhas/tokens de logs e capturas.
3. **Validar permissões na UI real:** usar contas com concessões mínimas, dois condomínios e revogação durante a sessão. Confirmar que o app Morador mostra sua própria audiência, que a API recusa ações não autorizadas e que background/retomada não exibe dados anteriores à revogação ou de outro condomínio.
4. **Exercitar fluxos com o backend real:** abrir avisos publicados, solicitações, reservas e demonstrativos autorizados; testar conflitos de reserva, aprovação e cancelamento. No Operação, validar leituras e tratamento de alertas conforme as capacidades concedidas. Conferir tanto o resultado visível quanto a alteração persistida no banco isolado.
5. **Injetar falhas de transporte:** interromper a conexão antes e depois do commit do servidor, atrasar corpo HTTP, entrar em background e encerrar o processo durante uma ação. Exigir erro recuperável e ausência de reenvio automático. Para portões, usar somente controlador/broker simulados e conferir no servidor que uma nova tentativa explícita conserva a mesma identificação quando o resultado é incerto; resposta do controlador não comprova posição física.
6. **Ampliar cobertura de dispositivos:** executar Android em mais de uma versão suportada, testar teclado, rotação, tamanho de fonte e leitor de tela; acrescentar execução em simulador iOS e aparelhos físicos controlados. Compilar iOS ou Android arm64 não substitui essa verificação de runtime. Notificações e distribuição nas lojas continuam dependentes das integrações e credenciais próprias de publicação.

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
