# Preparação reutilizável de Android sem dados dos apps

Proposta de 02/10/2026. **Cache/snapshot ainda não implementado nem validado no CI.** Um helper preliminar de fingerprint e preflight foi implementado e testado localmente, conforme o registro ao final. Objetivo: reduzir o primeiro setup do Android antes dos testes, preservando falhas de ambiente e todas as asserções dos produtos.

## Evidência que motiva a mudança

Os jobs de autenticação `36968348828` (`07760b2`) e domínios `36969718622` (`fc5f53a`) reprovaram com ANR do Pixel Launcher antes da instalação dos APKs. No segundo, a action enviou `KEYCODE82` às 05:47:58.711; o Android registrou ANR por ausência de janela focada às 05:48:04.548; o harness do projeto começou às 05:48:07.950. Havia CPU total de 98% e pressão de CPU `avg10=61.60` durante tarefas de setup/carregamento de ícones. Também havia espera por foco antes de `KEYCODE82`; logo, o comando não está demonstrado como causa exclusiva. Não houve ação de domínio executada.

A [action oficial recomenda](https://github.com/ReactiveCircus/android-emulator-runner#usage--examples) preparar um AVD com snapshot e iniciar o teste em outra execução com `force-avd-creation: false` e `-no-snapshot-save`. Seu exemplo não verifica a saúde do HOME nem restringe o momento de gravação do cache; precisamos dessas duas proteções adicionais.

O [Android documenta](https://developer.android.com/studio/run/emulator-snapshots) que snapshots incluem estado de aplicações e dados do usuário, são invalidados por mudança de imagem/emulador/configuração e exigem memória para salvar/restaurar. A documentação também alerta para instabilidade com renderização por software. Mantemos inicialmente `swiftshader_indirect` para medir a proposta sem trocar várias variáveis; compatibilidade real precisa ser demonstrada, não presumida pela recomendação da action.

## Recorte proposto

1. Criar uma preparação comum usada pelos quatro workflows, executada após SDK/KVM e **antes** de instalar dependências do projeto, iniciar API, gerar senhas/CA/fixtures ou compilar/instalar APKs. O sistema Android continua API 35 Google APIs x86_64/Pixel 6, quatro núcleos e 4096 MB; fuso explícito `Etc/UTC` em criação e consumo.
2. Instalar os componentes oficiais e calcular uma chave exata a partir das revisões reais de `source.properties` do emulador e da imagem, API/target/ABI, perfil/CPU/RAM/GPU/fuso, versão do preparo, sistema/arquitetura/imagem do runner e identificação de CPU relevante. A action pode atualizar componentes; um preflight anterior ao lançamento precisa recusar divergência em relação ao fingerprint. Não usar `restore-keys` parciais.
3. Usar `actions/cache/restore` separadamente. Em cache miss, criar um AVD limpo sem `-no-snapshot`; o script de preparo exige duas observações consecutivas do HOME atual, ausência de diálogo/ANR/crash, ADB íntegro, fuso correto e ausência dos dois pacotes `com.predioon.*`. O prazo é limitado e todas as tentativas ficam no diagnóstico. Nenhum erro ADB obrigatório ou ANR pode virar aprovação após um retry.
4. Somente após esse script passar, encerrar o emulador pela action, verificar arquivos do snapshot e escrever manifesto de saúde/fingerprint. Usar `actions/cache/save` **imediatamente nesse ponto**, ainda antes das credenciais/apps. Não usar o post-save automático de `actions/cache` no final do job: o diretório de dados do AVD pode ter sido alterado pelo teste. O cache nunca recebe o estado posterior ao login, mesmo com `-no-snapshot-save` no consumo.
5. Restaurar com a mesma configuração, `force-avd-creation: false` e `-no-snapshot-save`. O preflight comum é executado novamente; a ausência dos pacotes deve ser conferida antes da instalação. Somente depois instalar o APK e iniciar as ações de produto existentes. Nunca salvar esse segundo estado no cache.
6. Registrar origem cold/cache, fingerprint, sucesso real do carregamento do snapshot e preflight. Um cache hit não demonstra que o emulador carregou o estado: o log de boot deve distinguir restauração de fallback para cold boot. Snapshot incompatível, ADB não autorizado ou erro de restauração reprova a preparação e preserva evidência; invalidar pela versão de chave após diagnóstico, sem apagar e tentar de novo no mesmo percurso.

## Fronteira de arquivos e credenciais

O cache deve limitar-se ao AVD nomeado e seu manifesto. Nada do workspace, `.local`, APKs, banco, fixture, CA, assinatura ou diagnósticos autenticados entra nele. O exemplo da action inclui `~/.android/adb*`, que pode conter chave privada de ADB. A primeira proposta exclui esse glob: precisamos provar em um segundo runner que a conexão com uma chave ADB nova funciona ao restaurar o AVD. Se não funcionar, registrar a limitação antes de decidir um tratamento específico; não publicar uma chave privada por conveniência nem desativar autenticação do ADB.

O preparo não gera identidade de usuário ou login Google. O manifesto guarda versões, hashes, nomes de pacotes ausentes e resultado de verificações, sem conteúdo de contas. As evidências de falha de preparo são artefatos próprios, mesmo quando nenhum teste de app começou. O encerramento/criação do emulador é parte do CI descartável; não reiniciar o computador do usuário nem alterar o emulador local fechado por memória.

## Testes antes de integrar

- Fingerprint determinístico; cada alteração de revisão, configuração, renderer, fuso ou versão de preparo muda a chave. Paths/metadata inesperados devem ser recusados.
- Preparo falha com ANR, crash, pacote do produto presente, fuso divergente, ausência permanente de HOME e qualquer erro ADB obrigatório. Casos de HOME transitório continuam seguindo o contrato existente, com todas as tentativas preservadas.
- Em falha de preparo, não produzir selo de saúde nem habilitar save; verificar que a configuração usa restore/save separados e posiciona save antes de qualquer geração de credenciais ou instalação de APK.
- Cache hit deve exigir manifesto/fingerprint exatos e proibir save posterior. Não aceitar fallback parcial nem esconder erro de snapshot com novo cold boot automatizado.
- Primeiro ensaio CI: criar snapshot sem app/credenciais e recuperar no mesmo job para validar o transporte. Segundo ensaio em **outro runner**: restaurar a chave exata, confirmar ADB/HOME e pacotes ausentes, executar autenticação completa, comparar seu resultado e tempo de preparação aos logs anteriores. Exigir log de restauração real e ausência de recache depois do login.
- Repetir o domínio que ainda não completou, sem alterar seletores, mutações ou provas de banco. Uma aprovação de boot/autenticação não aprova esses módulos.

## Critérios de aceite e limitações

Aceite depende de duas execuções independentes com restauração comprovada, cache salvo somente com o sistema limpo, todas as verificações de preparação mantidas e percurso autenticado completo. A primeira criação continua sujeita à pressão do cold boot; se reprovar, o job falha e não publica cache. Cache também não substitui testes periódicos de cold boot; o smoke de inicialização deve conservar um modo explícito de execução fria.

O cache pode ocupar gigabytes e sofrer descarte pela plataforma. Não instalar infraestrutura externa ou contratar runner maior neste recorte. Se SwiftShader, autenticação ADB ou compatibilidade de snapshots impedir o aceite, registrar a evidência e avaliar outra configuração em mudança separada. Não declarar que o ANR foi corrigido apenas por acrescentar cache ao YAML.

## Incremento preliminar executado

`scripts/android-smoke/clean_avd.py` calcula um fingerprint determinístico dos `source.properties` oficiais, identificação de runner/CPU e configuração prevista. O comando `check` recusa divergência de fingerprint, execução fora de CI, credenciais/fixtures/APKs previamente gerados, aparelho físico, pacotes `com.predioon` (incluindo dados retidos), fuso diferente, boot incompleto, HOME instável, falha ADB e diagnóstico de ANR/crash. Não instala apps, não cria conta, não grava/restaura snapshot nem chama cache. Quando a guarda de credenciais, dispositivo ou pacotes reprova, não captura telas, hierarquias ou logs; grava apenas o resultado da recusa.

Foram preservados REDs por módulo inexistente e pela coleta indevida no `finally` do rascunho após uma guarda reprovar. Após correção, passaram **nove testes novos**, **32 testes do smoke comum** e **oito autenticados com TLS real**, em Linux. Os casos cobrem alteração de fingerprint antes de criar Device, tipos exatos do selo, recusa de dados prévios sem coleta, ANR/crash/ADB, fuso e estabilidade de HOME. O comando de metadata também leu os arquivos reais do SDK instalado (`emulator 37.2.12`, imagem API 35 revisão 9) em contêiner Linux, identificado como validação local; não houve emulador ou cache nesse ensaio.

Esse helper ainda não verifica os arquivos reais `config.ini` do AVD nem o conteúdo/carregamento de um snapshot, e a configuração no fingerprint é a **pretendida**, não uma medição do emulador. A integração deverá acrescentar essas provas e separar criação, validação e save antes de qualquer credencial. Nenhum workflow foi modificado por esse incremento. As reprovações `ccac601` de [reservas](https://github.com/helberjf/predioON/actions/runs/36972084490) e [domínios](https://github.com/helberjf/predioON/actions/runs/36972084470) repetiram ANR do launcher antes de iniciar o harness; continuam como falhas de preparação, com zero etapas funcionais aprovadas.
