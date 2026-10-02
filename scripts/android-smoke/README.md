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

A execução posterior [36961694145](https://github.com/helberjf/predioON/actions/runs/36961694145), commit `7319b3e`, aprovou Morador e reprovou Operação antes da primeira asserção da tela. O artefato de Operação `11208626614` mostra a tela correta do produto coberta pelo diálogo **Pixel Launcher isn't responding**; `activities.txt` identifica a janela ANR de `com.google.android.apps.nexuslauncher`, enquanto o buffer de crash do produto está vazio. Isso evidencia bloqueio do ambiente e não constitui aprovação do aplicativo. A preparação agora exige HOME utilizável e diagnósticos completos antes de instalar o APK; diálogos não são dispensados automaticamente e a próxima execução continua obrigada a passar todas as fases. Treze testes do harness passaram após essa mudança.

A reexecução [36963556661](https://github.com/helberjf/predioON/actions/runs/36963556661), commit `21706c8`, falhou nos dois produtos **antes da instalação**, com zero fases: `UIAutomator did not produce a hierarchy`. Os artefatos `11208388346` e `11209032904` foram preservados. A inspeção identificou um erro no próprio preflight: a chamada que obtém a árvore estava fora do tratamento do laço de disponibilidade de HOME, de modo que a primeira ausência de árvore encerrava a espera de 90 segundos imediatamente. A captura final já apresentava o launcher. O comando havia encerrado com código zero e seu stderr não tinha sido preservado; portanto não é possível afirmar se faltou estado idle ou nó raiz nessa execução.

A correção mantém o prazo de 90 segundos e exige duas observações consecutivas de HOME com diagnóstico obrigatório. Uma árvore ainda indisponível apenas registra outra tentativa dentro desse prazo, antes de instalar o app; ausência permanente continua reprovando. `environment-readiness.json` preserva cada tentativa, erro e stdout/stderr do comando, inclusive falha com exit zero. Não se lê XML antigo quando o dump não confirma saída nova. ANR/dialog bloqueante ou falha ADB/logcat continua encerrando o teste, sem fechar diálogos. A [implementação oficial do DumpCommand do AOSP](https://android.googlesource.com/platform/frameworks/testing/+/refs/heads/main/uiautomator/cmds/uiautomator/src/com/android/commands/uiautomator/DumpCommand.java) confirma que ausência de raiz ou timeout de idle escreve o erro em stderr e retorna sem gerar XML.

Dois testes novos falharam antes da correção. Depois dela, 17/17 testes comuns passaram em Linux, incluindo disponibilidade tardia, ausência permanente com histórico, stderr preservado e recusa de ANR; os oito testes autenticados também passaram com TLS/OpenSSL real. Essa aprovação do harness ainda precisa de nova execução em emulador. Nenhuma asserção de aplicativo foi dispensada.

### Primeiro boot, troca de HOME e recursos do emulador — 02/10/2026

As execuções do commit `17fb8d2` reprovaram antes de instalar os aplicativos. Foram baixados os três artefatos, sem descartar os resultados anteriores:

| Execução / produto | Job / artefato | Evidência observada |
| --- | --- | --- |
| [36964879870 — Morador](https://github.com/helberjf/predioON/actions/runs/36964879870) | `110707170533` / `11209965767` | ANR do Pixel Launcher, primeira observação, zero fases de app |
| [36964879870 — Operação](https://github.com/helberjf/predioON/actions/runs/36964879870) | `110707170300` / `11210265046` | Prazo de HOME esgotado, launcher visível na captura final, zero fases de app |
| [36964879846 — sessão autenticada](https://github.com/helberjf/predioON/actions/runs/36964879846) | `110706739985` / `11209452698` | Prazo de HOME esgotado, launcher visível, nenhuma fase de login dos dois produtos |

Nos dois timeouts, o log registra a abertura de HOME em `com.google.android.googlesdksetup/.DefaultActivity` e a troca automática para `com.google.android.apps.nexuslauncher/.NexusLauncherActivity` segundos depois. O harness resolvia HOME apenas uma vez e continuava procurando o pacote temporário durante todo o prazo. O código AOSP de [FallbackHome](https://android.googlesource.com/platform/packages/apps/Settings/+/refs/heads/main/src/com/android/settings/FallbackHome.java) também demonstra que o HOME pode mudar durante o desbloqueio e a conclusão do boot; `sys.boot_completed=1` sozinho não fixa a identidade do launcher.

A correção reconsulta a resolução do HOME em cada observação e registra `homeResolution` e `homeComponent` por tentativa. São necessárias duas observações consecutivas do **mesmo componente atual**, com sua árvore acessível e logcat obrigatório. A abertura de HOME continua única e o prazo continua de 90 segundos. Nenhum gesto de ação é repetido, nenhum diálogo é fechado e falhas obrigatórias de ADB permanecem fatais. As duas regressões novas falharam antes do ajuste: troca setup→launcher causava timeout e mudança de componente não reiniciava a contagem. Após o ajuste, passaram 19 testes comuns, oito autenticados com TLS real e sete de domínio em Linux. Isso confirma o harness local; a aprovação nativa deste ajuste depende de nova execução de CI.

O ANR do Morador é um problema ambiental separado: `Input dispatching timed out (Application does not have a focused window)`. O relatório do Android registra CPU total de 99%, pressão de CPU `some avg10=76.07` e pressão de memória `some avg10=11.07`. Os logs mostram dois núcleos virtuais e RAM elevada pelo próprio emulador para 2560 MB. Tanto essa falha quanto a aprovação autenticada anterior `eec6174` usaram emulator `37.2.12.0` e a mesma configuração; não foi identificada uma mudança de versão que explique a diferença.

Os três workflows Android passam a declarar quatro núcleos e 4096 MB de RAM, mantendo API 35, imagem Google APIs, Pixel 6, ABI e asserções. `nproc` e `free -m` registram a capacidade efetiva do host antes da inicialização. Este repositório é público; a [documentação de runners GitHub](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#standard-github-hosted-runners-for-public-repositories) especifica quatro CPUs e 16 GB para Linux padrão. A [action do emulador](https://github.com/ReactiveCircus/android-emulator-runner/blob/main/action.yml) aceita `cores` e `ram-size`, e o [Android documenta](https://developer.android.com/studio/run/emulator-commandline#common) RAM de 1536 a 8192 MB. O ajuste é uma **mitigação ambiental a verificar**, não uma correção comprovada do ANR. Qualquer novo ANR continua reprovando e preservando seus diagnósticos.

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
