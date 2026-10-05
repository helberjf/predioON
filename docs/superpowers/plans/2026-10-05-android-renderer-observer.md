# Observador mínimo do registro Fabric Android — desenho somente leitura

Data: 05/10/2026. Fonte do aplicativo examinada: `e5f98e481893860363aab2d3c050c532400e024c`, preservando a implementação Android da fonte `5a8d2f60f8c4fd810858483c560a9a34ded75b2c`. Antecedente: análise local de causa com SHA256 `a5b763f7477d6aa2ecab0c8db320ef66d5fca102b9e72667ab254562fb593fce`, resumida no [registro público Android5a8](../../evidencias/android-5a8d2f6.json). Este plano contém os pontos necessários para continuar sem depender daquele arquivo local.

**Recomendação:** a menor intervenção útil é um transformador ASM aplicado pelo módulo Android **app** às três classes exatas do AAR React Native 0.87.1, acompanhado de um gravador Java próprio e limitado. Isso observa as operações Java do registro efetivamente usadas pelo APK e mantém o C++ pré-compilado. Editar os arquivos Kotlin/C++ dentro de node_modules, por si só, não altera esse AAR.

O ponto de integração e as assinaturas binárias foram verificados abaixo. **O observador ainda não foi implementado, compilado ou incluído em um APK.** Esta investigação não executou Gradle, ADB, emulador, captura, teste nativo, CI ou comandos de SDK; não mudou produto, logger, flags, gates, B039,040 ou iOS. Não consultou os logs/APKs privados do incidente. Só foram lidos o relatório autorizado, código instalado/versionado, documentação oficial e partes públicas delimitadas do AAR oficial, em memória.

## 1. Por que a edição de fonte RN não basta

Nos dois aplicativos, `android/settings.gradle` inclui o build do **gradle-plugin**, não o build do ReactAndroid. `app/build.gradle` declara `implementation("com.facebook.react:react-android")`; `reactNativeDir` aponta para o pacote instalado, mas não é uma substituição desse módulo Maven por fonte. `ReactPlugin.kt:89–98` lê `ReactAndroid/gradle.properties`, e `DependencyUtils.kt:116–143` fixa a coordenada em `com.facebook.react:react-android:0.87.1`. A documentação oficial confirma que os releases normais consomem artefatos pré-compilados; compilar o framework exige uma substituição explícita em settings. [Build from source](https://reactnative.dev/contributing/how-to-build-from-source).

O pacote instalado declara AGP **9.2.1** e Kotlin **2.2.0** em `@react-native/gradle-plugin/gradle/libs.versions.toml`. Os apps usam Hermes, New Architecture e release sem minificação. O full domains chama `:app:assembleRelease -PreactNativeArchitectures=x86_64` em `.github/workflows/android-domains.yml:103`. Não há configuração local que recompile `FabricMountingManager.cpp`.

O CMake da aplicação compila o seu OnLoad/autolinking/codegen e vincula `ReactAndroid::reactnative` via Prefab (`ReactNative-application.cmake:49–84`). Ele não inclui automaticamente o arquivo C++ do Fabric como fonte da app. Portanto um hook C++ exigiria reconstruir/substituir a biblioteca nativa, um recorte maior e desnecessário para descobrir o componente/tag no primeiro experimento.

O diff Git entre 5a8 e HEAD foi vazio para os dois diretórios Android, os dois manifests móveis e `building-screen`, `app`, `resident`, `ui`, `resource`, `resource-poller`. Isso ancora a herança de fonte; não atesta que qualquer APK privado foi construído desses bytes.

## 2. AAR público e nomes reais de bytecode

Foi consultado o [manifesto Maven oficial](https://repo.maven.apache.org/maven2/com/facebook/react/react-android/0.87.1/react-android-0.87.1.module). A variante `releaseVariantDefaultRuntimePublication` aponta para [react-android-0.87.1-release.aar](https://repo.maven.apache.org/maven2/com/facebook/react/react-android/0.87.1/react-android-0.87.1-release.aar), tamanho **168.714.849 bytes**, SHA256 declarado `741849961df078890946c28aaeec6519a11e440940572d85126e6ea1539613a4`.

Não foi baixado o AAR inteiro, portanto seu SHA total acima é **metadado declarado**, não hash integral calculado pelo revisor. GETs HTTP Range aceitaram somente206 e comprimentos exatos: diretório ZIP e entrada `classes.jar`, sem salvar ou executar classes. A entrada tem 2.722.755 bytes comprimidos/2.965.580 bytes descomprimidos; SHA256 calculado de `classes.jar`: **`881e48b54f146ff5c99ea4ed965a844fa310b538ed0995e0a9353a68bd1a6b37`**. O diretório também contém `jni/x86_64/libreactnative.so` e o equivalente Prefab; essas bibliotecas não foram extraídas nem descompiladas.

Um leitor de classfile em memória verificou constant pool, nomes/descriptors e instruções invoke dos métodos abaixo. Não se inferiu o nome JVM a partir da grafia Kotlin.

| Classe do AAR | SHA256 calculado dos bytes `.class` |
| --- | --- |
| `com/facebook/react/fabric/mounting/SurfaceMountingManager` | `d7c1c5ae700f2070d24d252e42efc4fd7785c2a612e6ed106366399b2641c474` |
| `com/facebook/react/fabric/mounting/mountitems/IntBufferBatchMountItem` | `fc6759dfcf88ada7192f56506da190ea74a98c5227d95291758e89a3e1a85eab` |
| `com/facebook/react/fabric/mounting/mountitems/DestroyUnmountedViewMountItem` | `a61cff05f9d8a07003c9d4c35102909712605ac1ba1fe2b4688dd8c40a621882` |
| `com/facebook/react/fabric/FabricUIManager` — apenas referência do JNI, não alvo mínimo | `3e5766775ee70791f316d5b8636d42d3dae49b77482e41c84030ddb549fad2ce` |

Nomes binários relevantes:

- `createView$ReactAndroid(String,int,ReadableMap,StateWrapper,EventEmitterWrapper,boolean):void`, **não** `createView`.
- `createViewUnsafe(String,int,ReadableMap,StateWrapper,EventEmitterWrapper,boolean):void`, privado.
- `preallocateView(String,int,ReadableMap,StateWrapper,boolean):void`.
- `updateEventEmitter$ReactAndroid(int,EventEmitterWrapper):void`.
- `updateState(int,StateWrapper):void`; `updateLayout(int,int,int,int,int,int,int,int):void`.
- `deleteView(int):void`; `getNullableViewState(int):SurfaceMountingManager$ViewState`, privado.
- `stopSurface():void` e o corpo assíncrono privado estático `stopSurface$lambda$7(SurfaceMountingManager):void`.
- `IntBufferBatchMountItem.execute(MountingManager):void`; campos privados `surfaceId:I` e `commitNumber:I`.
- `DestroyUnmountedViewMountItem.execute(MountingManager):void`; campos privados surfaceId/reactTag.

A transformação acontece dentro dessas classes, portanto lê seus próprios campos/argumentos sem reflexão e sem precisar importá-las como APIs Kotlin públicas. O gravador da app recebe apenas primitivas e a classificação fechada; não precisa acessar construtores internos do RN.

## 3. Ponto de compilação sob a aplicação

Usar um pequeno plugin de build compartilhado, aplicado **somente ao projeto `:app` e à variante diagnóstica release escolhida**, por adesão explícita de build. Esse parâmetro é da instrumentação da app, sem alterar nenhum ReactNativeFeatureFlag. O plugin fornece a fonte Java do gravador à compilação da app e registra `variant.instrumentation.transformClassesWith(factory, InstrumentationScope.ALL)`. A factory aceita somente os três nomes completos acima; todas as demais classes são delegadas sem alteração. `PROJECT` não serve: deixaria o RN, que é dependência, sem instrumentação. [InstrumentationScope 9.2](https://developer.android.com/reference/tools/gradle-api/9.2/com/android/build/api/instrumentation/InstrumentationScope).

O plugin deve usar a API pública de instrumentação de AGP 9.2 e recomputar frames apenas dos métodos instrumentados; não usar a antiga Transform API nem substituir todo o `classes.jar`. As factories/visitors precisam tolerar chamadas paralelas de build; não acumular contagens globais mutáveis sem coordenação. As contagens e identidades obrigatórias devem ser verificadas em uma etapa determinística posterior sobre os bytes de saída. [Instrumentation 9.2](https://developer.android.com/reference/tools/gradle-api/9.2/com/android/build/api/variant/Instrumentation), [AsmClassVisitorFactory 9.2](https://developer.android.com/reference/tools/gradle-api/9.2/com/android/build/api/instrumentation/AsmClassVisitorFactory).

Possível ownership futuro, ainda sem criação de arquivo: plugin/validador em `scripts/android-renderer-observer/gradle-plugin`; runtime compartilhado `MountObserver.java` incluído como source da app somente quando o plugin é selecionado; adesão curta nos settings/builds dos dois apps. O plugin precisa ficar no build classpath, não ser apenas uma classe Java colocada em src/main. O gravador, por sua vez, precisa estar no runtime classpath da app; uma classe existente só no plugin Gradle não entra no DEX. Essa separação é parte do teste de empacotamento.

O plugin não deve substituir AAR por um stub, copiar uma segunda definição das classes RN para a app, usar um listener que consuma soft exceptions, ou depender de um patch não aplicado de node_modules. Uma reconstrução oficial de ReactAndroid seria alternativa válida, mas altera muito mais entradas e tempo de build; reservar para quando for indispensável observar o estágio C++ anterior ao batch.

## 4. Hooks mínimos e significados que não podem ser confundidos

### A. Registro real em SurfaceMountingManager

Instrumentar **as operações existentes do registro**, sem executar uma segunda consulta para adivinhar o resultado. No AAR inspecionado, estes callsites são:

| Método | Instrução original comprovada | Registro proposto |
| --- | --- | --- |
| `attachRootView` | `MutableIntObjectMap.set(ILjava/lang/Object;)V`, offset 132 | ROOT_SET; superfície/tag e tipo ROOT. |
| `createViewUnsafe` | mesmo set, offset 146 | REGISTRY_SET com tipo fechado proveniente do componentName do método; registrar após o set, ainda na região protegida. |
| `updateEventEmitter$ReactAndroid` | get offset 103; set offset 143 | REGISTRY_SET_VIRTUAL somente quando o set realmente acontece; o tipo é UNKNOWN se não há classificação comprovada. |
| `deleteView` | `remove(I)Ljava/lang/Object;`, offset 171 | REGISTRY_REMOVE com booleano do retorno; preservar integralmente o objeto/retorno original para o código RN. |
| `stopSurface$lambda$7` | `clear()V`, offset 369 | SURFACE_REGISTRY_CLEAR, diferente da simples solicitação stopSurface. |

Os offsets são evidência deste binário, **não uma estratégia de patch por endereço**. O transformador deve reconhecer owner/nome/descriptor e contexto, com hash pinado, e recusar zero ou contagens diferentes das esperadas. `getOrPut` foi inlined pelo Kotlin em get/set: observar apenas createViewUnsafe perderia esse terceiro caminho de inserção virtual. [Fonte oficial SurfaceMountingManager](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/fabric/mounting/SurfaceMountingManager.kt).

Entradas/saídas de createView/preallocateView registram **tentativa**, diferenciada do set efetivo. Não atribuir uma View criada a uma chamada que retornou cedo. O set de createViewUnsafe acontece antes de `viewManager.createView`; sua ocorrência comprova entrada no registro, não criação bem-sucedida de View Android. Delete solicitado durante toque ativo pode ser adiado; só o remove efetivo significa saída do registro. `sweepActiveTouchForTag` e seu delete posterior precisam receber origem TOUCH_DEFERRED, ou ficar explicitamente como origem UNKNOWN; nunca rotular esse remove como o delete original imediato.

Para `updateState`, duplicar apenas o resultado de `getNullableViewState` já calculado e reduzir a booleano; preservar a referência original. Para `updateLayout`, existem **duas consultas**: target, offset 10, e parent, offset 149. Os dois nulls geram a mesma categoria original e mencionam a tag consultada; o observador precisa distinguir `STATE_TARGET`, `LAYOUT_TARGET` e `LAYOUT_PARENT`. Guardar tag-alvo e parentTag numéricos, sem coordenadas/tamanhos. Não considerar um null de preallocate/create como erro: ele pode ser esperado.

No ramo null dos sinais reconhecidos, o gravador congela a janela **antes da chamada original** a logSoftException, sem substituir, envolver ou remover essa chamada. Não registrar listener no `ReactSoftExceptionLogger`: sua implementação troca o FLog de fallback por dispatch aos listeners quando existe algum, o que modificaria a evidência primária. Não encaminhar Throwable, mensagem ou stack para o observador. O logger original continua criando e emitindo a mesma exceção. [Logger oficial](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/bridge/ReactSoftExceptionLogger.kt).

Esse primeiro desenho cobre o sinal observado de state/layout e missing em delete. Se surgir primeiro uma soft exception fora desses ramos, o gate original continua a detectá-la, mas a coleta deve dizer `uncovered_primary_signal`; não declarar captura completa nem ampliar silenciosamente o matcher.

### B. Contexto do batch efetivamente executado

Instrumentar entrada e saída, inclusive saída excepcional, de `IntBufferBatchMountItem.execute`. Ler apenas seus campos int surfaceId/commitNumber e atribuir um contador local de batch. Enquanto esse execute chama SurfaceMountingManager, os eventos recebem esse contexto. Usar contexto limitado que seja restaurado em toda saída; uma exceção não pode deixar o próximo batch com a revisão anterior. Não chamar `toString`, não ler/copiar `objBuffer`, props ou StateWrapper. Não reimplementar o parser do intBuffer: observar os métodos realmente chamados evita um segundo interpretador divergente. [Batch oficial](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/fabric/mounting/mountitems/IntBufferBatchMountItem.kt).

O C++ chama `createIntBufferBatchMountItem` com `revisionNumber` (`FabricMountingManager.cpp:987–1000`). Esse número identifica a revisão fornecida ao batch, não todas as revisões fundidas. `MountingTransaction.mergeWith` substitui seu número pelo mais recente e concatena mutações. Assim, o observador Java **não prova quais commits foram agregados nem a ordem anterior ao reordenamento C++**. [FabricMountingManager](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/ReactAndroid/src/main/jni/react/fabric/FabricMountingManager.cpp), [MountingTransaction](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/ReactCommon/react/renderer/mounting/MountingTransaction.cpp).

### C. Destruição de prealocação

Instrumentar o contexto de `DestroyUnmountedViewMountItem.execute`, que chama o mesmo `SurfaceMountingManager.deleteView`. Sem isso, o ring distinguiria a remoção, mas não saberia que veio dessa origem. Preservar early return quando não há surface manager. A fonte C++ `destroyUnmountedShadowNode` já remove o registro de tags alocadas e chama JNI `FabricUIManager.destroyUnmountedView`; esse Java enfileira o item. O hook do execute observa **execução da destruição**, não seu pedido anterior no thread C++ nem GC como causa. Não duplicar a correção C++ já presente. [DestroyUnmountedViewMountItem](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/fabric/mounting/mountitems/DestroyUnmountedViewMountItem.kt), [FabricUIManager](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/fabric/FabricUIManager.java).

## 5. Contrato fechado do gravador

- Buffer circular pré-alocado de **até256 registros**. Proposta de registro fixo de 64 bytes: seq monotônica, tempo monotônico relativo, PID/TID, ordinal da instância de superfície, surfaceId, tag, parentTag, commitNumber, batch local, opcode, tipo fechado, flags de presença/origem. Não guardar wall-clock ou identidade de usuário.
- Até16KiB para o ring; tabela auxiliar igualmente limitada a 256 entradas para `(instância,surface,tag)→tipo/último estado`, sem referências a Views, ReactContext, ViewManager ou qualquer payload RN. Manter tombstones recentes após remove, pois um UPDATE posterior pode consultar uma tag excluída. Evicção gera `type_history_incomplete`; nunca recuperar um tipo por mera coincidência da tag de outra superfície/instância.
- A instância pode receber ordinal numérico em um campo diagnóstico privado adicionado pelo transformer após o super do construtor; não inferir identidade pelo surfaceId sozinho. Se for preferida uma tabela sem campo, sua ambiguidade/evicção deve ser explícita e não manter referência forte à superfície. Reservar também limite fixo para a pilha de contextos reentrantes; overflow marca contextoUNKNOWN e não cresce indefinidamente.
- A soma dos buffers auxiliares/exportação deve ter orçamento explícito. Uma exportação binária fixa de cabeçalho+256×64bytes fica abaixo de 64 KiB; um envelope textual posterior também deve impor **64KiB máximos**, truncando com flag antes de exceder. Não afirmar limite de heap total só pelo tamanho do ring: headers de objetos, índices, strings e cópias também precisam ser medidos na implementação.
- Tipos fechados por igualdade de nomes conhecidos: RCTView→VIEW; RCTScrollView→VERTICAL_SCROLL; AndroidHorizontalScrollView→HORIZONTAL_SCROLL; RCTText/RCTSelectableText/RCTRawText→TEXT; AndroidTextInput→TEXT_INPUT; AndroidProgressBar→ACTIVITY_INDICATOR; RNCSafeAreaView/Provider→SAFE_AREA; maisROOT,OTHER,UNKNOWN. AndroidHorizontalScrollContentView pode ter código próprio ouOTHER, declarado no schema. Nome desconhecido não é guardado nem hasheado. O nome recebido é usado só na comparação e não é retido.
- **Proibidos:** ReadableMap, StateWrapper, eventEmitter, Throwable, texts, props, accessibility labels, valores de input, IDs de conta/condomínio, caminhos de API, URLs, tokens, senhas, comandos físicos e nomes livres de componentes. Nenhum método `toString` de objeto RN e nenhum enableFabricLogs.
- Sequência do ring deve ser serializada com trabalho curto e sem callbacks RN; nas operações de registro, ordem de lock é registro→gravador. Exportador não toma lock RN nem escreve arquivo/log enquanto segura lock do registro. Stop/attach podem ocorrer em outro thread; registrar TID e preservar a ordem de observação, sem declarar uma ordem global causal do C++.
- Primeiro sinal reconhecido fixa a janela e flags; novas entradas não sobrescrevem o recorte congelado. `overwritten_count`, `mapping_evictions`, `context_overflow`, `observer_fault`, `uncovered_primary_signal` e `history_incomplete` não podem ser omitidos. Falha do observador não remove/transforma exceção do RN; cada chamada injetada deve preservar stack/retorno/fluxo e limitar seu próprio tratamento de erro.

Exportação mínima possível em uma etapa futura: emissão única e assíncrona, em tag diagnóstica separada, de schema/identidade fixa + blocos numerados da janela numérica. O logcat que o harness já coleta poderia conter esses blocos, sem receiver exportado, endpoint, permissão nova ou assinatura de produção. Ausência/truncamento de blocos torna o diagnóstico inconclusivo. O logger original do RN e o matcher dos gates permanecem inalterados. Isso é apenas desenho: nenhum exportador foi criado nem qualquer log nativo capturado nesta investigação.

## 6. Prova necessária antes de dizer “entrou no APK”

Uma execução de Gradle bem-sucedida não basta. A futura implementação deve produzir e revisar, nesta ordem:

1. **REDs de seleção/forma:** visitante aplicado a PROJECT não encontra RN; nome createView sem sufixo não encontra método; hash/descriptor diferente, zero ou múltiplos callsites inesperados falham. IsInstrumentable permite exatamente 3 classes; o runtime observer não é reinstrumentado.
2. **Testes do contrato da transformação:** comparar instruções originais e verificar que set/remove/get/logger/returns continuam presentes uma vez e na ordem original. Após remover somente as chamadas/labels diagnósticas, o fluxo original deve permanecer equivalente. Cobrir segunda consulta de parent em layout, getOrPut virtual, delete adiado, superfície limpa, prealocação destruída, early returns e exceção entre entrada/saída do batch. Verificar frames com ASM e compilação da variante release; sem alterar assinatura JNI ou nomes internos.
3. **Testes do ring:**256/257, rollover/evicção, superfície reutilizada, componenteOTHER sem retenção de string, reentrância/overflow, freeze único, falha do exportador e sinal original preservado. Injetar sentinelas de texto/credencial em props/state de doubles e conferir que não aparecem em buffers/exportação; APIs de gravação não devem aceitar tais objetos.
4. **Identidade do build:** coordenada/variante de AAR resolvida e hashes efetivos, classes de entrada/saída, hashes do plugin/runtime, lista e contagem de hooks. Não usar apenas o manifesto Maven público como prova do cache consumido pelo build. AAR/compilador inesperado deve falhar, não produzir APK sem observador.
5. **Verificação DEX pós-package:** confirmar a presença da classe própria e de suas chamadas dentro dos três tipos RN no APK selecionado; confirmar classes RN únicas. Não basta encontrar a string do nome da classe ou a fonte no ZIP. Registrar hash do APK, package/ABI/release e certificado efêmero da variante diagnóstica. Nenhuma assinatura de distribuição é necessária.
6. **Pré-condição observacional em execução futura autorizada:** marcador fechado de inicialização do observador vinculado à identidade do build, seguido de eventos reais de superfície/batch. Só então o roteiro original full domains poderia ser executado sem modificar ação, fixture, timer, critério ou repetição. Coleta incompleta é falha de diagnóstico separada, nunca aprovação do produto.

Esses itens são requisitos propostos e **não testes já realizados**. Nenhum CI novo deve ser apresentado como útil para atribuição até o item 5 demonstrar o hook empacotado.

## 7. Limites causais e decisão seguinte

Uma janela com SET(tipo X)→REMOVE→UPDATE ausente permite dizer que aquela tag era do tipo X e que houve remoção observada antes da consulta. Não prova por que o C++ produziu a sequência. CREATE tentado semSET, getOrPut virtual, clear da superfície, destruição de prealocação e histórico truncado são resultados distintos. UIManagerListener só recebe UIManager nos callbacks; ele não fornece essas operações/tags e não substitui o hook. Capturar árvore Android no fim também perderia views já removidas.

Não há motivo atual para escolher ScrollView como causa ou mudar clipping/teclado/GC/Fragment/pollers. A classificação deve ocorrer para todos os tipos, com UNKNOWN explícito. Se a atribuiçãoJava indicar que falta a sequência anterior ao batch, aí sim seria justificável um segundo experimento com reconstrução controlada de RN e observador C++ numérico antes/depois de merge/serialização. Ele precisaria de hashes das bibliotecas por ABI e prova de vinculação própria; não cabe fingir que editar o `.cpp` atual altera a `.so` pré-compilada.

## 8. Fontes primárias comparadas

Cinco arquivos RN instalados foram comparados por GET público do tag oficial v0.87.1, byte a byte; todos iguais:

| Fonte relativa ao pacote RN | SHA256 calculado |
| --- | --- |
| `ReactAndroid/src/main/java/com/facebook/react/fabric/mounting/SurfaceMountingManager.kt` | `01da06daa1d77c521f3deb54d44c5f64152e6851d3745c527ee34e61d8effd20` |
| `ReactAndroid/src/main/java/com/facebook/react/fabric/mounting/mountitems/IntBufferBatchMountItem.kt` | `c01e3920400d9a9577237a53efb90e722e974d05b7212c4021d398037901d454` |
| `ReactAndroid/src/main/java/com/facebook/react/fabric/mounting/mountitems/DestroyUnmountedViewMountItem.kt` | `282e37192eac3acce244a562119f466c89a4be609b777e588092df85dfec5575` |
| `ReactAndroid/src/main/jni/react/fabric/FabricMountingManager.cpp` | `263fc8bb42b0d767c9a4cc32982a0331615f1dfe63c3fec5b1859d8656aeba4f` |
| `ReactAndroid/src/main/java/com/facebook/react/fabric/FabricUIManager.java` | `c82c4ba0f4ff7fed1998aae013941632f923854da5bd378197129acc1732a46e` |

Configuração local conferida por leitura:

| Arquivo | SHA256 |
| --- | --- |
| `apps/resident-mobile/android/settings.gradle` | `86dd77b9f43b7e2ff27719f916874d2fa6c5d4948c2b15159ef827a6562deb73` |
| `apps/resident-mobile/android/app/build.gradle` | `e7b630cb86b1b6bf75c5ca7247994acbc047fdb339c5e13098db0fdd9e116f05` |
| `apps/resident-mobile/android/gradle.properties` | `ad5676f42702d1a9f811655c5d041ce13b0936011ef294e69ec6d230b660a985` |
| `apps/resident-mobile/android/app/src/main/java/com/predioon/resident/MainApplication.kt` | `9648f36f406848f8bd544d4957d5e5dfaedd3ac9962f7ec96e85b7232e7f31b3` |
| `apps/operations-mobile/android/settings.gradle` | `0822da2ffcad8d489669a1d7c94eeed5b2d955959364e3b65bebd00cbf11817e` |
| `apps/operations-mobile/android/app/build.gradle` | `c0752cf78c8e76e0e35ff5bd3b937c8aa0623c7f93115ac22304faa907d377bd` |
| `apps/operations-mobile/android/app/src/main/java/com/predioon/operations/MainApplication.kt` | `15053adc6ae26e8a3cb852aa439f11f783866da97ef010d8714c79dfeb392c3d` |
| `apps/resident-mobile/node_modules/@react-native/gradle-plugin/gradle/libs.versions.toml` | `c7a028cdee90f490de9493ca9de92b61b994844836161871091c340c568f109e` |

Na investigação original, nenhuma edição fora do relatório foi feita. A raiz publicou esta versão portável após revisar o desenho e os hashes locais; relatório original SHA256 `42d7c6894c5dcab5d4a21c7b29f80ff9da7976bf39282f92c311ab4a9e068d88`. Assinaturas/callsites binários e o mecanismo de instrumentação estão identificados; compilabilidade da implementação concreta, presença em DEX e comportamento em execução ainda precisam das provas futuras acima.

## 9. Retomada autorizada

O próximo trabalho autorizado é uma prova ASM em diretório descartável, com as três classes públicas reais, seleção/descriptors/contagens e preservação das instruções/frames. A integração no código dos apps ainda exige revisão dos paths e das provas. Não alterar logger/gates/flags, executar nova captura nativa ou declarar presença em DEX nesta fase. Atualizar [CONTINUIDADE.md](../../CONTINUIDADE.md) ao congelar uma implementação concreta.
