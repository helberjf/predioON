# Regressão do renderer Android do Morador

Este recorte procura reproduzir os avisos nativos do commit `1f7bd3d`: 12 eventos `MissingViewState` e oito incompatibilidades de `removeViewAt` no processo do Morador, observados durante Avisos → Transparência → expansão dos lançamentos → Solicitações. Os logs dos dois diretórios dos apps contêm os mesmos eventos do emulador; não devem ser somados como ocorrências independentes. O único aviso de Operação na jornada de senha fica fora deste recorte.

**Estado:** harness e testes de host implementados. A execução nativa deste workflow ainda é necessária. Um resultado verde em Python não demonstra ausência de SoftExceptions no APK nem aprovação completa dos apps.

## Execução isolada

`.github/workflows/android-renderer.yml` cria PostgreSQL 16/TimescaleDB 2.17.2 exclusivo do job, aplica o ledger e provisiona as quatro contas runtime. Reutiliza a fixture sintética transacional de `android-domain-smoke`, incluindo vizinhos proibidos e dados financeiros publicados/rascunhos. O JSON de fixture e a senha aleatória ficam privados; o mascaramento do console não é usado como autorização para publicar arquivos brutos.

O adapter TLS existente altera apenas o checkout efêmero de verificação, com API HTTPS no host do emulador e CA de um dia. Somente o APK release x86_64 do Morador é compilado/instalado. O adapter comum também prepara a fonte da Operação nesse checkout, mas ela não é compilada ou exercitada aqui. Nenhuma configuração, dependência ou biblioteca React Native do produto é alterada pelo incremento do harness.

O dispositivo precisa ser o único conectado, ter serial `emulator-*`, `ro.kernel.qemu=1`, boot completo e HOME estável. Os diretórios precisam estar dentro de `RUNNER_TEMP`, sem symlinks, com os flags explícitos de CI e banco descartável. O runner não oferece override para um dispositivo físico ou banco de demonstração. O workflow usa as mesmas configurações API 35, Pixel 6, quatro cores, 4 GiB, animações desativadas e limites de espera da jornada de domínios.

## Jornada e gates

1. Instalar/limpar apenas o Morador, confirmar o snapshot inicial da fixture e limpar logcat uma única vez antes do startup.
2. Abrir MainActivity uma vez, vincular exatamente um PID e iniciar leitura contínua `logcat --pid=PID -b main -v epoch '*:V'`. A história de startup ainda no buffer é inspecionada após a vinculação. Mudança/ausência de PID ou falha da coleta reprova; não se aceita um processo novo como continuação do anterior.
3. Fazer login uma vez, selecionar o condomínio e observar seu aviso publicado. As buscas e entradas usam os controles reais e os mesmos limites da classe `DomainDevice`.
4. Abrir Transparência, exigir o relatório publicado e o botão habilitado `Ver lançamentos (1)`, expandir uma vez e observar o lançamento após a rolagem existente.
5. Retornar ao topo, abrir Solicitações e exigir a solicitação própria. Não criar chamado, comentar, reconhecer alerta ou revogar concessões.
6. Confirmar novamente o snapshot inicial, sem alterações no domínio, ausência de crash/ANR e o mesmo processo. Fechar o coletor próprio e reconferir qualquer negativa tardia antes da exportação.

Antes/depois dos comandos são feitas observações PID; a leitura contínua protege o intervalo entre elas contra a perda de eventos por rotação do buffer. `MissingViewState` reprova já no cabeçalho. A incompatibilidade que tenta remover um filho e encontra outro tag, assim como um filho já removido, reprova. Uma SoftException não classificada de `SurfaceMountingManager` também é terminal; seu cabeçalho pode ser a primeira negativa antes da linha detalhada de `removeViewAt`. Stack frames isolados e logs de outro PID não são classificados como essa falha.

Uma negativa não é `AssertionError` transitório: bloqueia o próximo comando, gesto ou coleta de UI. Não há retry da ação, descarte de warnings, limpeza posterior do logcat, aumento de prazo ou `continue-on-error`. Privacidade e exposição de credenciais permanecem terminais, inclusive em telas incompletas. Todas as capturas de tela e a coleta final herdada estão desativadas neste recorte.

Cada fase e gesto gera marcador de conteúdo fechado (`sequence`, `phase`, `boundary`, `kind`) pelo logger do aparelho. O timestamp `epoch` do marcador é confirmado por uma leitura independente da tag fixa. A exceção tem seu próprio timestamp do logcat; a atribuição temporal pode ser feita contra as fronteiras dos marcadores, sem inferir causa pela última tela. Os marcadores não contêm texto digitado, coordenadas, email, senha, label de fixture ou conteúdo da árvore.

## Artefato público

O único upload é `result.json`, com esquema fechado: app constante, sucesso/categoria, PID numérico, marcadores, primeira negativa (categoria e horário) e `domainSnapshotUnchanged`, que confirma apenas o snapshot descrito acima. O login grava naturalmente a sessão; esse campo não afirma que todo o banco ficou sem alterações. O exportador recusa campos extras, strings arbitrárias, sequência fora de ordem e sucesso sem todas as fases e pares de ações esperados.

`source` registra commit real obtido de Git, SHA-256 calculado dos bytes do APK, React Native `0.87.1`, Android API `35` e ABI `x86_64`. O digest é reconferido contra o `build.json` privado gerado pelo adapter de assinatura/badging; hashes fornecidos pelo ambiente não são exportados. O manifesto do app e as propriedades do emulador precisam corresponder à allowlist. Essas versões precisam de revisão explícita do harness caso mudem. A fonte refere-se ao commit antes dos adapters TLS do checkout descartável, não a um APK de loja.

XMLs eventualmente escritos pelos métodos herdados, fixture, APK, CA/chaves, logs de API/proxy, stdout/stderr de ADB e logcat bruto ficam exclusivamente no diretório privado do runner e não são enviados. Os processos locais do API/proxy usam grupos próprios; limpeza verifica o PID, início, grupo e sessão antes de sinalizar. Se o líder já terminou, não sinaliza um grupo potencialmente reutilizado. A remoção de dados usa apenas as identidades da fixture validada. O descarte do job/emulador encerra os processos restantes.

## Verificação de host e limites

```sh
python3 -B -m unittest discover -s scripts/android-renderer-smoke -p 'test_*.py' -v
actionlint -shellcheck= -pyflakes= .github/workflows/android-renderer.yml
```

Os testes verificam ambas as assinaturas, primeira negativa preservada, PID/diagnósticos, bloqueio da próxima ação, ausência de screenshots, exportação fechada e incompleta, origem calculada do APK/Git, erros de CLI sem argumentos privados, isolamento de paths/dispositivo e limpeza sem sinalizar PID reutilizado. Um teste TLS real sobe backend/proxy locais descartáveis e prova que leituras passam e escritas do domínio/comandos físicos nunca chegam ao backend. No Windows sem OpenSSL, esse teste tem skip explícito. A implementação teve RED por módulo ausente; endurecimento teve RED para sucesso sem jornada e finais/paths ainda não implementados; origem/CLI teve RED para os campos novos e proteção ainda ausente. Esses REDs de host não são reprodução nativa da falha do aplicativo.

O monitor acrescenta chamadas ADB e marcadores; isso pode alterar a cadência do harness sem mudar os timers do aplicativo ou os limites herdados. Uma execução verde isolada não exclui uma corrida intermitente. É necessário primeiro reproduzir a negativa nativa e então estudar a menor correção, mantendo este gate. Não se atribui a causa ao React Native, IME, coleta de lixo ou `BuildingScreen` apenas pela proximidade temporal. A identificação do app usa PID, sem prova independente do instante de criação do processo Android; reinício com reciclagem do mesmo PID entre duas leituras seria um limite residual.

O código primário do [React Native 0.87.1](https://raw.githubusercontent.com/facebook/react-native/v0.87.1/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/fabric/mounting/SurfaceMountingManager.kt) registra as SoftExceptions durante montagem/remoção de views. A documentação oficial de [logcat](https://developer.android.com/tools/logcat) descreve seus buffers, filtros e timestamps. Essas fontes explicam os sinais usados pelo gate; não provam a causa do caso observado.
