# Domínios na interface Android — 02/10/2026

Este recorte exercita a UI real de Morador e Operação contra API HTTP/PostgreSQL isolados. É separado do [E2E de sessão](../android-auth-smoke/README.md): não substitui seus testes de persistência/rotação. O workflow `android-domains.yml` compila dois APKs release x86_64 em checkout efêmero, instala ambos em emulador API 35 e usa UIAutomator/ADB para interagir com os controles existentes. Não há respostas simuladas no percurso nativo.

**Estado:** harness, fixture e verificações de contrato implementados; a primeira execução nativa deste roteiro ainda não foi aprovada. Testes Python e API local não devem ser apresentados como evidência de que essas telas passaram no emulador.

### Primeira execução preservada

A [execução 36965837399](https://github.com/helberjf/predioON/actions/runs/36965837399), commit `c106a78`, job `110709277239`, reprovou **antes de instalar os APKs**. O artefato `11210147243` foi baixado e inspecionado: zero fases nos dois apps, 24 tentativas de HOME, primeiro dump com `null root node` e stderr preservado, seguido de divergência de pacote até o prazo de 90 segundos. O log registra HOME temporário `com.google.android.googlesdksetup` às 04:53:29 e abertura de `com.google.android.apps.nexuslauncher` às 04:53:31; o XML final contém o launcher. Não foi encontrada evidência de ANR/crash de app nesse percurso, pois os aplicativos ainda não haviam sido instalados.

É a mesma resolução inicial de HOME já corrigida em `f13f89c`, conforme [diagnóstico do harness comum](../android-smoke/README.md#primeiro-boot-troca-de-home-e-recursos-do-emulador--02102026). O novo workflow reconsulta HOME e declara recursos explícitos, mas esse ajuste só será considerado verificado quando a nova execução terminar. A primeira falha não representa teste executado de avisos, contas, chamados ou alertas.

### Execução com HOME corrigido e campo fora da tela

A [execução 36966606934](https://github.com/helberjf/predioON/actions/runs/36966606934), commit `f13f89c`, job `110711756119`, passou a preparação e executou **11 fases do Morador** antes de reprovar. O artefato `11210293019` registra entrada vazia, preenchimento, autenticação real, perfil/condomínio, aviso, prestação publicada, lançamento, solicitação própria e criação de uma nova solicitação. Operação ainda não havia iniciado; comentário, revogações e snapshot final também não foram executados.

A falha `UI node has no visible area` corresponde ao campo nativo `Nova mensagem`, cujos bounds no XML são `[103,2352][979,2337]`: estava abaixo da parte visível. A busca por campo retornava após validar rótulo/classe, antes de validar seus limites; a etapa de digitação recusou corretamente o toque. O ajuste verifica os bounds dentro da busca e usa a rolagem limitada existente antes de devolver o campo para digitação. Não altera o aplicativo nem repete toque/envio. Duas regressões falharam antes do ajuste (campo oculto seguido de visível; campo permanentemente oculto); depois passaram os nove testes de domínios e os oito de autenticação com TLS real em Linux. Uma nova execução nativa ainda é necessária para concluir o percurso completo.

## Identidades e autorização

A fixture cria uma organização, dois condomínios, dois usuários dos apps, um vizinho e papéis exclusivos da execução. Não cria memberships legadas, privilégios de plataforma ou permissões sobre comandos físicos. A senha alfanumérica é aleatória e mascarada pelo workflow; não faz parte da fixture JSON.

| Perfil | Concessões deliberadas | Limite observado |
| --- | --- | --- |
| Morador | Seleção do próprio condomínio (`buildings:read`), `notices:read`, chamados próprios/criação; `finance:read-published` em binding separado | Aviso vigente, contas publicadas e autoria própria. Não recebe gestão financeira nem chamados vizinhos. |
| Operação/dispositivo | `buildings:read`, `devices:read`, `telemetry:read`, `alerts:read`, `alerts:acknowledge`, todos no mesmo dispositivo exato | Bare `/v1/authorization` continua negado. O resumo descobre leitura parcial; nenhum grant vale para sensor/alerta vizinho. |
| Operação/chamado | `buildings:read` e `occurrences:manage` em uma única ocorrência | Pode atualizar/comentar apenas esse chamado; não recebe criação global. |

`buildings:read` existe explicitamente para a descoberta exigida pelo backend. No Operação fica nos bindings de recurso, sem virar concessão inteira. Remover o último binding também remove a descoberta e a leitura de features, cujo erro esperado é conferido pela API real e depois pela UI.

## Roteiro nativo

1. Validar emulador descartável, boot e HOME estável usando a preparação comum. Instalar os dois APKs, limpar somente seus dados e conferir o estado inicial das fixtures.
2. Morador faz login, seleciona seu condomínio e vê o aviso publicado. Texto de aviso futuro, conteúdo do outro condomínio ou vizinho reprova imediatamente, inclusive enquanto a tela esperada ainda carrega.
3. Abrir Transparência e expandir os lançamentos da prestação publicada. Rascunho financeiro e relatório estrangeiro são proibidos. Comprovantes externos não são abertos neste recorte.
4. Ver apenas a solicitação própria, preencher título/descrição pelos campos nativos, enviar uma única vez, comentar e conferir persistência no banco. Nenhuma mutação é repetida para contornar resposta lenta.
5. Operação seleciona seu condomínio e vê Resumo com chamados de escopo parcial, somente seu sensor, somente seu alerta e somente seu chamado concedido. Reconhece o alerta e inicia/comenta o chamado pela interface.
6. Revogar o binding do dispositivo no host enquanto sua leitura está aberta. Após Home/retomada, exigir que sensor/alerta e as abas correspondentes sumam; o chamado concedido continua disponível.
7. Revogar o binding do chamado enquanto a conversa está aberta. Após retomada, exigir o erro de escopo atual e ausência do conteúdo/ações anteriores. A API nega novas alterações; o vizinho permanece intacto.
8. Reabrir Transparência no Morador, revogar apenas o binding financeiro e retomar. Informes da gestão continuam autorizados por avisos; contas e lançamentos devem desaparecer.
9. Conferir o snapshot final de persistência, sair em ambos e exigir formulários vazios e diagnósticos sem crash/ANR.

Busca de controles usa texto/accessibilityLabel, classe nativa, unicidade, estado habilitado e limites visíveis; coordenadas de toque vêm da árvore atual. Rolagem é limitada e serve apenas para localizar controles reais. O script não desenha telas, injeta dados em React nem chama a API para simular uma ação da UI. Consultas de snapshot e revogação da fixture são operações do host de teste, distintas das ações do usuário.

## Evidências e isolamento

`database-*.json` guarda apenas contagens/estados do domínio: solicitação criada, comentários, estado do chamado/alerta, bindings ativos e ausência de eventos no vizinho. Os nomes/títulos dos dados são fictícios. A fixture permite limpeza somente dentro da organização/identidades geradas; criação transacional e `finally` do teste local limpam mesmo quando a preparação ou asserção falha.

O workflow reutiliza TLS, assinatura e diagnósticos de sessão, sem duplicar o adaptador ADB. A única extensão da fábrica do proxy é aceitar uma política de rotas opcional; sem ela permanece a allowlist original de autenticação. O proxy de domínios admite apenas leituras necessárias, criação/comentário de ocorrência, PATCH de ocorrência e reconhecimento de alerta. Não admite administração, gravação financeira, resolução de alerta, portões, MQTT ou URLs externas.

Confiar na CA adicional continua restrito ao APK gerado no checkout descartável. O upload contém `build.json`, fases XML/PNG, resultados e logs sanitizados; exclui APKs, fixture, senha, tokens e chaves. Retenção de sete dias. `environment-readiness.json` conserva falhas de preparação. Nenhum diagnóstico obrigatório é dispensado após instalar os apps. Uma falha de privacidade é terminal, sem aguardar que o conteúdo desapareça para aprovar a fase.

## Validação local e comandos

Os testes foram escritos antes da implementação do módulo de assertions (o primeiro RED registrou o módulo ainda inexistente). A suíte atual possui sete testes: allowlist de método/rota, tenant/conteúdo, controles nativos, prova de persistência, recusa de aparelho físico, recusa imediata de conteúdo privado e transporte TLS real. Este último sobe backend HTTP e dois proxies HTTPS locais, confirma que o proxy padrão recusa PATCH, que a política de domínios encaminha o PATCH autorizado com corpo/tipo corretos e que nenhum proxy encaminha o comando físico. A suíte autenticada também deve passar após a extensão opcional do proxy, incluindo TLS real com OpenSSL.

O teste `test_fixture.mts` inicia o servidor real em porta aleatória, cria dados isolados e valida os contratos do roteiro: descoberta/features, financeiro publicado, avisos, autoria, criação/comentário, resumo031, sensor exato, reconhecimento, gestão exata, recusa dos vizinhos e revogação. Ele não controla emulador. A configuração TypeScript usa os tipos Node do workspace da API, sem globais React Native.

```bash
python3 -m unittest discover -s scripts/android-domain-smoke -p 'test_*.py' -v
python3 -m unittest discover -s scripts/android-auth-smoke -p 'test_*.py' -v
pnpm --filter @predioon/api exec tsc --project ../../scripts/android-domain-smoke/tsconfig.json
```

Após provisionar banco descartável pelas migrations e papéis documentados em `docs/MIGRATIONS.md`, configurar as quatro URLs de banco, `NODE_ENV=test` e segredo JWT de testes. `ANDROID_DOMAIN_DISPOSABLE_DB=1` é obrigatório e a fixture recusa banco que não esteja em loopback:

```bash
ANDROID_DOMAIN_DISPOSABLE_DB=1 pnpm --filter @predioon/api exec tsx --test ../../scripts/android-domain-smoke/test_fixture.mts
```

No checkout de CI preparado, o percurso usa:

```bash
python3 scripts/android-domain-smoke/run_domains.py --fixture .local/android-domains/fixture.json --apks .local/android-domains --artifacts .local/android-domains/evidence
```

## Continuidade e limites

A reexecução [36968150387](https://github.com/helberjf/predioON/actions/runs/36968150387), commit `ee7922a`, job `110716279815`, reprovou antes de enviar o primeiro login. O artefato `11210504463` contém apenas a fase de entrada vazia do Morador aprovada; Operação não iniciou seu percurso. O XML final mostra e-mail truncado, e o logcat registra descarte de eventos antigos durante a digitação por ADB. A causa e o ajuste testável em lotes estão no [diagnóstico comum](../android-smoke/README.md#digitação-longa-por-adb--02102026). Essa execução não chegou ao campo de comentário que motivou o ajuste de rolagem anterior; sua aprovação nativa permanece pendente.

A execução [36968348834](https://github.com/helberjf/predioON/actions/runs/36968348834), commit `07760b2`, artefato `11211215762`, reproduziu a mesma falha de entrada: somente `01-login-blank` passou, seguida de e-mail divergente; logcat novamente registrou descarte de eventos antigos. Ela também antecede o ajuste de lotes `d7b37e8`. Nenhuma fase de domínio ou calendário foi aprovada por essa execução.

A execução [36969718622](https://github.com/helberjf/predioON/actions/runs/36969718622), commit `fc5f53a`, artefato `11211641078`, reprovou antes da instalação, com ANR do Pixel Launcher e zero fases de ambos os apps. O logcat situa o ANR por ausência de janela focada antes de iniciar o harness, durante o primeiro setup do Android; a preparação não fechou nem ignorou o diálogo. A autenticação isolada do mesmo commit passou, mas não substitui a validação deste percurso.

A execução [36970203958](https://github.com/helberjf/predioON/actions/runs/36970203958), commit `f622949`, artefato `11211449269`, avançou para 12 fases do Morador e 13 de Operação. Aviso, demonstrativo/lançamento, solicitação própria, criação e comentário do Morador passaram, com snapshot persistido. Operação passou por resumo parcial, sensor/alerta permitidos, reconhecimento, conversa e início de atendimento. A execução reprovou ao procurar o texto do comentário após voltar ao topo: a API registrou um único POST de comentário com `201`, a UI final mostrou “Mensagem enviada.” e o XML situou o cartão seguinte abaixo do viewport, após o evento de mudança de estado. Não chegou ao snapshot de ações da Operação nem às revogações. Os dois buffers de crash estavam vazios.

O harness aguarda “Mensagem enviada.” após um único envio e só então localiza o TextView exato e visível por até nove observações/oito rolagens antes da asserção do comentário. Nenhum toque ou envio é repetido. Três novas regressões cobrem cartão fora da tela, ausência permanente sem reenvio e confirmação lenta/ausente que impede iniciar a rolagem; passaram 12 testes de domínios e oito de reservas com TLS real em Linux. A aprovação nativa desse ajuste ainda depende da execução seguinte; o `201` isolado não substitui a asserção visual nem a prova completa de persistência.

A execução [36972084470](https://github.com/helberjf/predioON/actions/runs/36972084470), commit `ccac601`, job `110727970259`, artefato `11212183120`, reprovou antes de instalar qualquer APK, com zero fases dos dois apps. Os PNG/XML finais confirmam diálogo de ANR do Pixel Launcher. O logcat situa o ANR por ausência de janela focada às 06:17:41.326 UTC, antes do harness iniciar às 06:17:44.743 UTC; a pressão de CPU `avg10=63.18` ocorreu durante o primeiro setup do sistema. A falha foi preservada, sem fechar o diálogo ou repetir login. Ela não exercitou o ajuste de comentário `ed21b67`, posterior a esse commit.

A execução [36973342801](https://github.com/helberjf/predioON/actions/runs/36973342801), commit `ed21b67`, job `110731795774`, artefato `11212980675`, repetiu ANR do launcher no primeiro HOME, antes de instalar os apps, com zero fases. O logcat registra ANR às 06:32:24.816 UTC e início do harness às 06:32:25.526 UTC. Portanto essa execução também não validou o ajuste do comentário; os artefatos e a falha de preparação foram preservados.

Reservas com conflito/aprovação/cancelamento tem [roteiro separado](../android-reservation-smoke/README.md), também pendente de percurso nativo completo. Ficam pendentes mensagens/arquivos anexos, gestão de equipamentos, notificações, fonte/tela/orientação, modo offline, iOS e aparelhos físicos. O cenário não inclui comandos físicos nem entrega assinatura de loja.

Vídeos completos por app continuam previstos no [roteiro de gravação](../android-auth-smoke/README.md#gravações-completas-ao-concluir-o-plano). Este workflow ainda não grava vídeo; screenshots não serão apresentadas como uma gravação. A publicação do resultado deverá citar commit, execução, artefato e quais fases realmente passaram, mantendo eventuais falhas anteriores.
