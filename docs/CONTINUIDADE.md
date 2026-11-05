# Continuidade do Prédio ON

Atualizado em **05/11/2026**, horário de São Paulo. Leia este arquivo primeiro ao retomar, em qualquer computador. A [retomada de 03/11](RETOMADA_2026-11-03.md) registra a comparação com o GitHub, os rascunhos preservados e a ordem de validação. O histórico anterior está em [continuidade/historico-ate-2026-10-17.md](continuidade/historico-ate-2026-10-17.md); a entrega de entrada pública, testes e VPS está em [VERIFICACAO_2026-10-24.md](VERIFICACAO_2026-10-24.md).

**Checkpoint atual de MFA — 05/11:** [fontes e roteiro recuperáveis](continuidade/2026-11-05-mfa-integracao/README.md), base `53c4c70`: 58 arquivos de implementação/testes candidatos, dois testes de renderer e cinco suportes. Os **nove testes dirigidos de status de dispositivos passaram**, além de sete regressões separadas, **71 casos sem falhas/skips/cancelamentos**. [Prova específica](evidencias/mfa-device-events-2026-11-05.json). A [montagem/restauração passou](evidencias/mfa-device-restore-2026-11-05.json), com todos os 1.016 arquivos idênticos à composição testada.

O comparador anterior entregou um DTO persistido de quatro campos após a promoção administrativa; o teste decodificou esse frame antes de falhar. A correção mantém duas observações protegidas: contexto e uma rechecagem posterior de autoridade, preservando expiração de suporte e a regra ANY de funcionalidades sem exigir leitura nova de sensor. As regressões incluem os 17 testes originais de alertas e 13 de telemetria. A política obrigatória continua candidata, fora do runtime da `main` (001–067). Restam os 25 originais de equipamentos, gateway/heartbeat, demais domínios/mutações, integração web/nativa e operação.

**Escopo de encerramento confirmado pelo proprietário em 05/11:** concluir Android, iOS, webapps e APIs com seus fluxos; validar a matriz completa com Playwright e usar codegen para registrar/verificar jornadas; entregar scripts para abrir os sistemas e instruções de uso; preparar um documento para explicar todos os sistemas em entrevistas e apresentações. Esses materiais finais devem refletir o sistema efetivamente validado. Imagens versionadas, vídeos atualizados e documentação completa continuam no plano. **Não reiniciar o computador nesta sessão.**

O [roteiro de fechamento em quatro lotes](superpowers/plans/2026-11-05-mfa-fechamento-e-demonstracao.md) identifica as lacunas concretas de MFA e os scripts existentes de abertura, demonstração e codegen. Sua auditoria é estática; os critérios de saída exigem novas provas.

**Materiais de apresentação em elaboração:** o [roteiro para entrevistas](ROTEIRO_ENTREVISTA.md) explica os cinco produtos, arquitetura, decisões e exemplos de testes; o [guia de abertura](COMO_ABRIR_OS_SISTEMAS.md) reúne os scripts existentes, portas, execução nativa e Codegen. Ambos distinguem instruções de aceitação observada. Os [oito cenários do launcher passaram no PowerShell 7.6.5](evidencias/launcher-behavior-pwsh7-2026-11-05.json), com arquivos isolados e ferramentas simuladas. A [tentativa separada no Windows PowerShell](evidencias/launcher-preflight-2026-11-05.json) foi bloqueada antes do primeiro caso. Não houve mudança de política nem inicialização de serviços reais. Validar abertura real e revisar os materiais na fonte final continuam pendentes.

## Estado corrente verificado em 05/11

| Verificação | Resultado observado | O que continua aberto |
| --- | --- | --- |
| API completa | 865/865, zero falhas/skips, fonte4eb7cab | Revalidar após mudanças de identidade; não equivale a produção |
| Ingestão completa | 220/220, zero falhas/skips, fonted43dc46 | Carga MQTT/hardware e integração em condomínio |
| Cliente publicado / UI / mobile | Cliente `9e79bde`: 25 dirigidos + 118 originais; candidato atual: UI 143/143 e mobile 242/242, execuções separadas | Consumidores MFA ainda candidatos; jornadas atuais em aparelhos |
| Tipos e builds | 14 pacotes + tiposE2E; seis builds de produção aprovados, fontea2c8ab1 | Android/iOS não compilados nesta rodada; distTSC pode conservar arquivos antigos |
| Playwright dirigido | Chromium:20 aprovados e dois skips originais, fonte14e3008; API sintética | Matriz completa atual com backend/PostgreSQL e demais motores |
| MFA obrigatória da plataforma | Device-status 9/9 e sete regressões separadas: 71 casos; resolução/tipos dirigidos aprovados | Original25 de equipamentos, gateway/heartbeat, outros domínios/mutações e regressão integrada pendentes |
| Android / iOS | Tipos atuais; evidências nativas anteriores conservam suas datas | Câmera/aparelhos Android, Apple/distribuição e jornada iOS atual |
| Operação e apresentação | Restore067 aprovado; imagens novas no Git | VPS/TLS/e-mail/hardware reais, documentação final e cinco vídeos atualizados |

[Tipos/builds: prova, comandos e limites](evidencias/types-production-builds-2026-11-04.json). A máquina não foi reiniciada. Cada ensaio usou banco descartável e conferiu base vazia e seis roles restauradas. Os quatro serviços de outro projeto, pausados com autorização, já voltaram a executar por ação externa. As fontes dos testes e builds estão identificadas em cada prova; não somar contagens de execuções diferentes nem transformar compilação em homologação. Os checkpoints narrados abaixo conservam o histórico da rodada; este quadro orienta a retomada atual.

**Base recebida nesta retomada:** a `main` do GitHub foi consultada e a cópia local avançou de `456df8f` para **`dba63dc9478dc738bb035f1d75a626764f7fcd75`**, de 30/10/2026. Foram incorporados **136 commits**, com **606 arquivos diferentes** entre as duas bases. A árvore atual contém migrations **001–067**. Esses números descrevem o código obtido; não são resultados de testes novos. A implantação completa da VPS e o aceite de produção continuam pendentes.

**Primeiro incremento publicado:** `1769caf` corrige somente as expectativas de ledger dos testes, de **62 para 67**. O RED real falhou no caso dirigido de notificações e nos dois restores. Depois da correção, **notificações 54/54** e **restauração 2/2** passaram, com **68 tabelas, 67 migrations**, dados, ACL/RLS e seis roles conferidos; tipos DB e fronteiras passaram. [Fonte, hashes e resultados](evidencias/ledger067-2026-11-03.json). Essas execuções não aprovam a API, Playwright ou apps atuais. Em 04/11 foram concluídas as provas dirigidas de ingestão e reservas descritas abaixo; a regressão geral atual e os aceites dos consumidores continuam pendentes.

**Preservação e CI:** os 12 rascunhos antigos foram guardados em backup local manifestado e stash seletivo antes do avanço da `main`, sem reaplicação. SQL040 e seu teste ACL já são idênticos aos publicados. O [run de plataforma 41106369658](https://github.com/helberjf/predioON/actions/runs/41106369658), da fonte `dba63dc`, consta como `startup_failure` nos metadados consultados; não valida as suítes. Os cinco vídeos existem, mas foram gravados em **18/10**, antes das mudanças atuais. [Detalhes, limites e próximos passos](RETOMADA_2026-11-03.md).

**Histórico da demonstração de 25/10:** `predioon-admin.vercel.app`, `predioon-sindico.vercel.app`, `predioon-morador.vercel.app` e API `predioon-api.vercel.app`. Os três logins foram verificados naquela rodada com Playwright; não foram revalidados nesta retomada. A rodada de 24/10 partia de `c53117d6`, com migrations 001–059. Banco `predioon-demo-db`, Neon `bold-leaf-99201114`, São Paulo, somente dados fictícios. Usar explicitamente `db:infra --provider=neon-demo` e provisionamento `--api-only`; nunca reaplicar seed. O perfil conserva as proteções de runtime, tem checksums próprios e não executa o agendador Timescale nem os workers permanentes. [Evidência histórica dos logins, refresh e logout](evidencias/vercel-neon-2026-10-25.json).



**Fixtures iOS publicadas em 03/11:** `02c53e2` corrigiu dois defeitos de portabilidade apenas no teste host. Dois REDs reais, dirigido 4/4, Linux **146/146**, Windows **122 aprovados e 24 skips**, revisão independente e dez fontes protegidas conferidos; gerador, runtime, guard ATS/TLS, Swift e workflows intactos. [Prova e limites](evidencias/ios-fixture-portability-2026-11-03.json). Não houve build Apple nesta rodada.

**Ingestão publicada em 04/11 — `39c434f`:** nove casos adicionais de handler/SQL para OFFLINE, atomicidade e cooldown. GREEN **49/49** na versão V1; três controles de regressão isolados produziram **46/3, 48/1 e 47/2** (aprovados/falhas esperadas). A V2 publicada acrescenta somente tipagem do resultado SQL: checagem estrita passou e o JavaScript transpilado é idêntico, sem alegar repetição dos 49 casos. Adjacentes separados: pipeline **8/8**, receipt-policy **8/8** e mqtt-runtime **2/2**. [Fonte, revisão, hashes e limites](evidencias/ingest-lastwill-cooldown-2026-11-04.json). Os nove novos casos não reproduzem a emissão de Last Will por broker real; não somar as execuções para anunciar uma integral.

**API dirigida na fonte `39c434f`:** quatro arquivos originais passaram em processos seriais: limites/eventos **8/8**, capacidades de áreas **17/17**, capacidades de reservas **15/15** e privacidade **7/7**. São **47 casos observados**, sem falhas/skips/cancelamentos, em banco UUID novo com 67 migrations; não é a suíte API inteira. [Prova, hashes e limpeza](evidencias/api-reservations-2026-11-04.json). Nos ensaios, roles, credenciais privadas e configurações foram restauradas por igualdade em memória, com bancos temporários removidos; nenhum reinício ou OOM do container.

**Checkpoint de ingestão publicado: zero rascunhos.** A fonte de ingestão já está publicada em `39c434f8d9206e8b3071c185f3dca7b16d79fe5e`. O [manifesto](continuidade/2026-11-03-manifesto.json) registra patch vazio e a conferência de cinco arquivos de teste extraídos por Git archive dessa base exata. Não aplicar patch vazio nem reaplicar 040/runtime. O antigo checkpoint de um arquivo/base `02c53e2` permanece histórico no commit `40438da`.

**Preparo do Playwright — `c619844`:** o workflow de navegador passou a fornecer também as credenciais fictícias de ingestão e acesso, exigidas pelo provisionador completo. Mudança de duas linhas, revisão estática independente, actionlint exit 0 e **173/173 testes locais de validação**, sem banco real. O run remoto dessa fonte continua em `startup_failure`, com zero check runs; a causa não foi confirmada. A correção não equivale a CI aprovado. [Prova e limites](evidencias/browser-ci-runtime-env-2026-11-04.json).

**Recursos medidos antes do navegador:** às 03:44 UTC de 04/11, após parar somente o cluster descartável ocioso desta QA, havia 1822 MiB livres. Isso não atendeu aos guards de 4096 MiB para a integral nem de 2048 MiB para focus/regras isoladas. Nessa medição, nenhuma suíte de navegador atual foi iniciada. Manter os guards e continuar verificações menores em série, sem fechar aplicações desconhecidas nem reiniciar computador, Docker ou WSL. O cluster foi deixado parado, sem OOM/restart, base vazia e seis roles preservadas.

**Consumidores compartilhados na fonte `c619844`:** passaram os globs originais completos de cada pacote, em processos seriais: cliente HTTP **118/118**, UI **130/130** e mobile compartilhado **236/236**; zero falhas, cancelamentos ou skips. Node 24.19, heap 384 MiB, uma execução por vez, sem banco, navegador, emulador ou build nativo. Fontes e lockfile preservados. [Resultados, hashes e limites](evidencias/shared-consumer-units-2026-11-04.json). Não substituem testes dos três portais, da API inteira nem Android/iOS nativos.

**Planejamento histórico — MFA administrativa:** o [plano técnico revisado](superpowers/plans/2026-11-04-platform-admin-mfa.md) preserva decisões, arquivos, etapas, riscos de concorrência e testes a executar. Nesse ponto estava **planejado, sem implementação ou RED executado**; o checkpoint ativo abaixo registra os incrementos posteriores, ainda sem aceite integrado. A proposta inclui sessão restrita, prova por família/geração do fator, autoridade por flag ou binding vigente, proteção HTTP/SSE e adaptação dos três portais/apps. O inventário de fixtures é estático, sem contagem de falhas. A migration068 é somente proposta: a fonte publicada continua em 001–067. Não confundir esse plano com a entrega da obrigatoriedade ou alterar a base existente para testá-lo.

**Tentativa de navegador atual — fonte `c619844`:** Prepare passou em ambiente Linux isolado; Focus foi interrompido por parada coordenada do runner após forte pressão no limite de 1280 MiB. **Nenhum resultado de caso concluído foi reportado; não há PASS nem RED do produto.** A listagem de 15 Focus/7 Rules não é execução aprovada. Rules não foi iniciado. Foram preservados logs, cópias e a limitação do check final de fonte, que não pôde executar com o container parado. [Evidência e limites](evidencias/playwright-focus-resource-abort-2026-11-04.json). Próximo ajuste: permitir iniciar somente o portal selecionado nos testes de foco, preservando os critérios e identificando as execuções separadas.

**Playwright dirigido aprovado — fonte `14e3008`:** a nova seleção por portal preserva o padrão e reduz os Vites simultâneos. Quatro execuções em Chromium: administração **4 aprovados + 1 skip original**, condomínio **4 + 1**, morador **5/5** e regras salvas **7/7**; os dois skips são o caso exclusivo do morador. Fonte conferida após cada fase e no final, specs intactas, OOM0 e evidências revisadas. Houve pressão no teto1280 MiB, sem ampliar limites. [Prova de resultados e hashes](evidencias/playwright-focused-portals-2026-11-04.json). API sintética: não substitui a matriz atual com backend/PostgreSQL nem aceite Android/iOS. [Duas capturas reais do web responsivo](imagens/2026-11-04/README.md) foram preservadas sem edição e incluídas no Git. Próxima verificação: API geral serial em DB UUID; depois demais regressões e o recorte MFA planejado.

**Primeiro checkpoint de MFA: um arquivo novo, ainda não executado.** Seis casos foram autorados e revisados estaticamente em cópia externa; não houve teste/typecheck, RED observado, implementação ou migration068. [Manifesto e instruções](continuidade/2026-11-04-mfa-reds-manifesto.json) e [patch](continuidade/2026-11-04-mfa-reds.patch), base exata14e3008; restauração comprovada somente para esse novo arquivo. O arquivo não foi inserido no glob real da API, que conserva81 arquivos. O checkpoint vazio anterior é o da ingestão já publicada. Rever a fronteira de catálogo/flag/suporte010 antes do aceite da política MFA. Próximo: baseline API atual, depois RED dirigido em UUID exclusiva e implementação.

**API geral atual aprovada — fonte `4eb7cab`:** uma execução original serial dos **81 arquivos**, **865/865 casos e 74 suítes**, zero falhas/skips/cancelamentos, **19min29s**. Flags de integração ativas, PostgreSQL UUID com67 migrations; cleanup e seis roles/credenciais/settings restaurados por igualdade privada, bancos/clients temporários0. Os989 arquivos fora de docs foram conferidos antes/depois; a atualização documental paralela atéee542 não mudou código. [Prova, recursos e limites](evidencias/api-full-baseline-2026-11-04.json). É o baseline anterior à MFA obrigatória, não aceite dessa implementação futura ou de produção. Ingestão completa também passou220/220 no checkpoint abaixo; builds, RED/implementação MFA e aceites nativos/operacionais ainda pendentes.

**Ingestão geral atual aprovada — fonte `d43dc46`:** glob original dos **21 arquivos**, uma execução serial, **220/220 casos,18 suítes**, zero falhas/skips/cancelamentos, **47,5s**. UUID oficial com67 migrations, runtime INGEST/ACCESS restrito e cleanup/restauração privada das seis roles conferidos. Os989 arquivos fora de docs permaneceram idênticos. Dois casos MQTT usam Aedes local; não são ensaio físico. O receptor original não herda o heap384 do runner; não se mediu seu picoRSS. [Prova, recursos e limites](evidencias/ingest-full-baseline-2026-11-04.json). Tipos dos14 pacotes, tiposE2E e seis builds de produção também passaram no checkpointa2c8ab1. Próximos: RED/implementação MFA, matriz real de navegador e aceites nativos/operacionais.

**Corrigenda MFA e recuperação de drafts:** a obrigação planejada é conta ativa com flag legado **OU** autoridade021ADMIN vigente; pre/post-gates separados não fecham promoção transitória nem a lacuna entre assert eSELECT. [Análise e desenho ainda pendente](superpowers/plans/2026-11-04-platform-admin-mfa-policy-refinement.md). Um [segundo checkpoint](continuidade/2026-11-04-mfa-races-manifesto.json) preserva dois casos de concorrência, **não executados**, com cleanup revisado estaticamente. Agora são dois arquivos de draft/oito casos planejados fora do glob real81; não há implementação/migration068. O sexto controle antigo precisa da correção documentada de flag/catálogo; seus bytes históricos foram preservados.

**Preparação nativa corrigida — `b259f80`:** seis workflows Android e o gerador iOS autenticado agora fornecem as duas conexões fictícias ausentes de INGEST/ACCESS ao provisionador completo. O parser original rejeitou os sete ambientes anteriores e aceitou os sete corrigidos; actionlint1.7.12 passou. O teste do gerador iOS usa mocks: sete chamadas de24bytes, valores fictícios distintos e todos mascarados, sem escrever arquivo de ambiente ou gerar segredo real. [Prova e revisão](evidencias/native-ci-runtime-env-2026-11-04.json). A consulta remota pontual mostrou sete suítes na fila e uma startup_failure, zero check runs; não é aceite de CI nem build Android/iOS.

**Checkpoint anterior de MFA e recursos:** [seis fontes recuperáveis](continuidade/2026-11-04-mfa-candidato/README.md), quatro candidatas API de prova por família e dois testes/nove casos corrigidos, mais SQL candidato documental e mapa. Parser e typecheck da API candidata passaram; nenhum DB/RED/GREEN do candidato. A tentativa do baseline foi recusada após readiness por RAM<1536MiB, antes de Node/UUID/testes; banco616a parado após base0/temp0/clients0/roles6, sem OOM/restart/remove. Amostra imediatamente após stop:752MiB; depois recuperou cerca de3GB com banco desligado. Etapas pesadas dependem de nova medição e dos guards. [Prova](evidencias/mfa-memory-refusal-2026-11-04.json). Os checkpoints anteriores de seis/dois casos ficam históricos, sem alterar seus hashes. Não aplicar a fatia incompleta a produção.

**Tipos do candidato MFA aprovados, sem execução funcional:** uma compilação TSC noEmit da API isolada com as quatro fontes candidatas passou em13,962s, guard2826MiB/heap640,989 fontes e quatro overlays conferidos. [Prova e revisão](evidencias/mfa-family-typecheck-2026-11-04.json). O primeiro preflight recusou dez diferenças somente CRLF/LF antes de TSC; preservado e corrigido apenas no harness, com freezes separados e exceções exatas. Esse PASS não inclui os nove testes futuros, migration, HTTP, banco ou apps. Banco permanece parado. Os últimos752MiB eram amostra imediatamente após stop; depois a memória se recuperou para cerca de3GB com banco desligado. Para novo ensaio de banco, reservar folga antes de iniciar e manter guard1536 após readiness; matriz integral de navegador exige4096.

**CI: causa observada no navegador em 04/11.** O [resumo autenticado do run 41842973688](https://github.com/helberjf/predioON/actions/runs/41842973688) informa que o job não começou por falha em pagamentos recentes **ou** por limite de gastos insuficiente. O texto não distingue essas duas condições. [Registro da observação](evidencias/ci-account-blocker-2026-11-04.json). Nenhuma configuração ou cobrança foi alterada. A [investigação anterior pela API](evidencias/ci-startup-investigation-2026-11-04.json) fica histórica: os 15 workflows passaram no actionlint local, mas não havia mensagem de causa nos endpoints consultados. Esse bloqueio não aprova os testes e não demonstra defeito nos YAML. O proprietário precisa regularizar a condição da conta antes de retomar os runners; depois, conferir uma execução nova da fonte exata.

**Incremento publicado — cliente MFA `9e79bde`:** [25 testes dirigidos, 118 originais e tipos do cliente aprovados](evidencias/mfa-client-transport-2026-11-04.json). Mudanças de autorização preservam a identidade, os resultados de confirmação/códigos e a rotação da mesma família; respostas privadas antigas são descartadas. Nova identidade/logout continuam soberanos. Foi reproduzido e corrigido o caso da troca de senha já confirmada em 204 durante uma restrição concorrente. Não há repetição automática de escrita negada por MFA. A API atual ainda não entrega os motivos novos de obrigatoriedade.

**Checkpoint histórico de integração MFA — 04/11:** [47 arquivos restauráveis](continuidade/2026-11-04-mfa-integracao/README.md), com cinco do transporte já publicados e 42 candidatos: backend 16, consumidores V5 24 e dois testes de banco. Quatro patches disjuntos e hashes dos 47 arquivos restaurados foram conferidos. Os [sete testes puros do backend](evidencias/mfa-http-candidate-2026-11-04.json) e os [19 testes puros dos consumidores V5](evidencias/mfa-consumer-candidate-2026-11-04.json) passaram em execuções distintas; revisão estática concluída. A API candidata terminou a checagem de tipos em timeout sem resultado. Não houve execução dos nove casos PostgreSQL, React renderizado, tipos V5 ou aceite integrado. SQL, HTTP/SSE real, Playwright completo e nativos continuam pendentes; API/schema publicados permanecem 067.

**Primeira ação de retomada:** consultar a main e seguir o checkpoint de05/11, montando e conferindo a cópia canônica em diretório novo. Não reaplicar transporte/query já publicados nem os patches históricos por cima da composição atual. Executar tipos e11 casos SQL V2 quando os guards permitirem; depois completar os guards dos demais domínios/SSE/mutadores e revalidar regressões. Nenhum reinício é necessário ou autorizado nesta sessão.

**Avanço da integração — registro de 05/11:** [prova consolidada](evidencias/mfa-integration-validation-2026-11-05.json). A memória liberada permitiu executar os nove casos PostgreSQL: todos falharam nas asserções previstas sobre a base067, sem falha de preparação, timeout ou skip. Foram reproduzidos o estado MFA ausente, acessos administrativos ainda permitidos, desativação do fator e três mudanças de autoridade durante a leitura. Cada teste parou na primeira negativa, portanto as etapas posteriores não foram todas exercidas. A fixture UUID foi removida e seis roles/credenciais/configurações restauradas; base e clientes ficaram vazios. O banco próprio foi parado depois da conferência, sem reiniciar computador/Docker/WSL.

Na composição candidata, passaram os tipos de 11 pacotes/apps e quatro testes React renderizados da cerimônia, com fontes conferidas. Estes usam React/renderer19.2.3 e primitivas HTTP/browser sintéticas; não aprovam DOM, aparelhos ou o React19.3.0 do web. Os nove REDs ainda não são GREEN da implementação. O timeout anterior fica histórico: sua duração incluía hashes posteriores, sem medição isolada da vida do compilador. SQL ampliado e ligação das listas estão em revisão externa; não entraram no runtime publicado.

**Correção web de recuperação MFA — 05/11:** o painel compartilhado agora consulta o estado somente depois de “Já guardei os códigos”. Antes, uma falha nessa consulta podia esconder os códigos recém-gerados. Baseline: uma falha legítima e um controle aprovado; correção: dois casos Playwright aprovados; nova execução com captura: dois aprovados. Tipos E2E e actionlint passaram. [Prova e limites](evidencias/mfa-recovery-codes-2026-11-05.json); [imagens reais](imagens/2026-11-05/README.md). Esta correção independente não conclui a MFA administrativa obrigatória. O teste usa o portal real e HTTP sintético; a CI remota continua sem aceite.

**Integração MFA candidata — segundo avanço de 05/11:** nove casos PostgreSQL passaram na composição SQLV3/HTTPV4/backend/consumidores, com fixture UUID própria,68 migrations e conexões restritas. Os mesmos nove tinham falhado por asserção na base067. Sete testes puros de projeção passaram após três controles negativos reproduzirem a incompatibilidade do construtor SQL; tipos da API candidata também passaram. A limpeza confirmou zero bancos temporários/clientes e restauração de seis roles/configurações/credenciais. [Prova auditada e limites](evidencias/mfa-sql-envelopes-candidate-2026-11-05.json).

Somente o helper de projeção e seus sete testes entraram na API publicada, sem ligar rotas novas ou aplicar068. Na main, esses sete casos e os tipos src da API passaram novamente. [Prova do incremento independente](evidencias/mfa-query-foundation-2026-11-05.json). A política obrigatória continua incompleta: outros domínios/projeções/SSE, mutações sem correspondência, promoção durante desativação, expiração após lock e leitura após triggers ainda exigem implementação/testes. Os11 casos SQL complementares V2 estão escritos; a revisão corrigiu um código de prédio duplicado na fixture, mas V2 ainda não executou no banco. A tipagem da V1 anterior passou e não é aceite da V2.

## 1. Instruções permanentes do proprietário

- Commits pequenos em Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`), com push na `main` depois de cada incremento verificado.
- Rodar os testes de banco, API, ingestão, clientes, Playwright e nativos apropriados. **Nunca** desativar proteções nem enfraquecer asserções para aprovar.
- **Não reiniciar o computador.** Esta máquina tem 16 GB e pouca memória livre: carga excessiva já coincidiu com um reinício. Ver a seção 5.
- Nunca rodar seed/reset numa instalação existente. A demonstração 037 fica intacta.
- Nunca repetir automaticamente comandos de acesso físico; sem fallback para a conexão owner; não editar migrations já publicadas (a base atual contém 001–067). Correções de dados ou DDL exigem uma nova migration revisada.
- Não contornar o bloqueio salvo da galeria 8765.
- Sugestões vão para [MELHORIAS_E_EVOLUCOES.md](MELHORIAS_E_EVOLUCOES.md). Imagens conferidas entram nos commits, com origem e limites, via [IMAGENS_DOS_SISTEMAS.md](IMAGENS_DOS_SISTEMAS.md).
- Ao terminar: abrir os três portais e os apps Morador/Operação e entregar cinco gravações separadas com dados fictícios. **Gravações existentes de 18/10:** [docs/videos](videos/README.md); elas não demonstram as funcionalidades acrescentadas depois dessa data.

## 2. O que existe

| Parte | O que faz | Referência |
| --- | --- | --- |
| Portal da administração | Carteira de condomínios e clientes, gateways e equipamentos, funcionalidades, usuários, acesso de suporte, auditoria, **saúde dos serviços** (058) | [FUNCIONALIDADES.md](FUNCIONALIDADES.md) |
| Portal do síndico | Água, energia, sensores, alertas e regras padrão (066), ocorrências, avisos, áreas e reservas com limites mensais e cancelamento pela gestão (064/067), eventos com presença (064), portões e vagas (desligados por padrão), **totem do QR do portão** (adicional, 059), transparência, ordens de serviço, ativos, **automações por alerta e programadas** (045/057), unidades/equipes/permissões, convites, acesso de suporte | [GESTAO_TRANSPARENTE.md](GESTAO_TRANSPARENTE.md), [ORDENS_DE_SERVICO.md](ORDENS_DE_SERVICO.md), [ATIVOS.md](ATIVOS.md), [AUTOMACOES.md](AUTOMACOES.md) |
| Portal do morador | Avisos, ocorrências, reservas, transparência, acessos e vagas, consumo liberado pelo síndico, perfil e sessões, convite | [CONSUMO_E_ANALISE.md](CONSUMO_E_ANALISE.md) |
| App Morador (React Native) | Avisos, solicitações, reservas, transparência, acessos com **leitura do QR do totem** (059), consumo, troca e recuperação de senha, MFA na entrada, **aceite de convite** | [packages/mobile/README.md](../packages/mobile/README.md) |
| App Operação (React Native) | Resumo, alertas, sensores, ordens de serviço com distribuição | idem |
| API (Express) | Autenticação com cookies/CSRF na web, MFA, recuperação por e-mail (Resend), **confirmação recente para ações privilegiadas** (055), RBAC por capacidade com RLS em todo o banco | [AUTENTICACAO.md](AUTENTICACAO.md), [AUTORIZACAO.md](AUTORIZACAO.md) |
| Ingestão (MQTT/EMQX) | Telemetria, estados de gateway, comandos físicos com ACK, só com logins restritos (052); heartbeat de saúde (058) | [SENSORES.md](SENSORES.md), [ACESSOS.md](ACESSOS.md) |
| Worker de notificações | Entrega durável de alertas por webhook (038) | [NOTIFICACOES_DURAVEIS.md](NOTIFICACOES_DURAVEIS.md) |
| Banco | PostgreSQL 16 + TimescaleDB 2.17, seis roles restritas, RLS, auditoria; capacidade e retenção medidas (056) | [DATABASE_MODEL.md](DATABASE_MODEL.md), [MIGRATIONS.md](MIGRATIONS.md) |
| Implantação | Compose de produção com healthcheck nos seis serviços, Caddy com TLS, backup e restauração ensaiados | [DEPLOY.md](DEPLOY.md), [BACKUP_E_RESTAURACAO.md](BACKUP_E_RESTAURACAO.md), [IMPLANTACAO_CONDOMINIO.md](IMPLANTACAO_CONDOMINIO.md) |

## 3. Estado das etapas da arquitetura

| Etapa | Estado |
| --- | --- |
| 1. Contratos e cliente HTTP | Concluída |
| 2. Identidade e RBAC | Fundação e módulos implementados: capacidades (2B.3, 054), gestão web integrada (2B.4), convites, MFA, recuperação e confirmação recente (2C, 055). **Pendência da decisão já registrada do proprietário:** tornar a MFA obrigatória para a administração da plataforma, com cadastro forçado no primeiro acesso. A MFA opcional existente não cumpre essa exigência. |
| 3. Processamento durável | Outbox e worker de notificações (038), ingestão sem owner (052), garantias de telemetria (048). A fila separada da inbox foi adiada conscientemente ([INBOX_DECISOES.md](INBOX_DECISOES.md)). |
| 4. Domínios | Ativos (044), ordens de serviço (043), automações por alerta e programadas (045/057), suporte com concessão explícita (053). **Planos/assinaturas: não iniciado**, por decisão. |
| 5. Apps | Implementados, com testes e jornadas nas rodadas históricas abaixo; percorridos no emulador em 18/10 (vídeos), sem avisos Fabric naquele logcat. Esses resultados não aprovam as mudanças posteriores da base atual. Caminho iOS preparado: EAS Build/Submit sem Expo SDK e `scripts/ios-mac/verify.sh` para um Mac emprestado. **Pendentes:** regressão atual, build Android com câmera, primeiro build iOS com assinatura de distribuição, iOS autenticado e homologação em aparelhos. |
| 6. Implantação e operação | Artefatos prontos e ensaiados localmente (Compose, healthchecks, backup/restauração, retenção, saúde dos serviços). **Sem implantação real.** |

## 4. Histórico de releases e validações

Os resultados desta seção pertencem às datas e fontes indicadas. Não constituem uma nova execução na fonte atual; as provas dirigidas de 04/11 estão resumidas acima.

**Releases de 17/10:**

| Release | Commit | Resumo |
| --- | --- | --- |
| 052 | `57df9c7` | Ingestão e acesso físico só com logins restritos |
| 053 | `d8038f9` | Acesso temporário de suporte com concessão e prazo |
| 054 | `5c8514e` | Contas e vínculos legados por capacidade; fim da 2B.3 |
| 055 | `f1455ab` | Confirmação recente de senha (e MFA) para ações privilegiadas |
| 056 | `b5dc7f5` | Catálogo de séries (últimas leituras 1,3 s → 0,27 s), retenção opt-in, capacidade medida |
| 057 | `f7b98d2` | Automações programadas no agendador do TimescaleDB |
| 058 | `d5bc847` | Saúde dos serviços na administração e healthchecks do Compose |
| app | `f4d4720` | Convite no app Morador |
| teste | `5a08d1b` | Restauração: espera do lease pelo relógio do banco (encerrou a intermitência aberta em 06/10) |

**Depois (18/10):** datas ISO nas rotas lidas pelos apps (o app Operação mostrava "Data indisponível"), correção do `demo:data` e os cinco vídeos. API 828/829 na integral (1 intermitente conhecido, 3/3 isolado), ingestão 204/204, teste novo de datas 2/2.

**Depois (18–20/10), sem nova rodada integral:**

| Commit | Resumo |
| --- | --- |
| `19ea7f3` | iOS pelo EAS Build/Submit sem Expo SDK: `eas.json` por app (perfis `production` e `simulator`), hook que grava a origem HTTPS de `PRODUCTION_API_URL` no `config.ts` e falha sem ela, ícones iOS provisórios ([apps](../packages/mobile/README.md#ios-sem-mac-eas-build)) |
| `194bb04` | Workflows iOS (`ios.yml`, `ios-auth.yml`) só por disparo manual: o minuto macOS conta 10× na cota do repositório privado |
| `a2e1f50` | `scripts/ios-mac/verify.sh`: pré-requisitos, testes, simulador, iPhone por cabo (`--device`), TestFlight (`--testflight`) e relatório. Passa no shellcheck, **ainda não rodou num Mac** ([guia](../scripts/ios-mac/README.md)) |
| `949fc2f` | Playwright por área em `e2e/specs/`, banco próprio (`pnpm e2e:db`), `@smoke` que abre todas as páginas dos portais, gravador (`pnpm e2e:record`), specs novas de funcionalidades e de água/segurança, agentes de teste para o Claude Code ([guia](../e2e/README.md)) |

**Provas históricas da rodada de 17/10, em clusters próprios:** banco 301/303 (2 skips de backup, cobertos pelo teste próprio), api-client 118/118, UI 108/108, mobile 224/224, API 827/827, ingestão 204/204; SQL052 73/73; serviços restritos 114/114; restauração 2/2 três vezes; ingestão real com broker 12/12; Playwright Chromium completo 117/117. [Evidência](evidencias/releases-055-058-2026-10-17.json).

**Mudanças posteriores presentes na base de 30/10:** limites de reservas e eventos (064), responsável nominal de ordens de serviço (065), regras padrão de alertas (066), padrão mensal por apartamento (067), cancelamento de reserva pela gestão, correções de desconexão/cooldown por sensor e ajustes das apresentações web. A [auditoria de 28/10](CORRECOES_AUDITORIA_2026-10-28.md) registra tipos/build da ingestão e nove testes MQTT, sem integração PostgreSQL naquela rodada. Conferir os testes apropriados dessas mudanças antes de afirmar nova aprovação integral.

## 5. Como retomar e testar nesta máquina

**Memória:** antes de qualquer etapa pesada, confira a memória livre. Historicamente, o VM do Docker (vmmemWSL) chegou a ~5 GB e a memória livre caiu a 0,3 GB. Na QA dirigida de 04/11, foi usado um cluster exclusivo de 384 MiB/1 CPU, uma execução por vez; na API, parent Node 256 MiB, filhos 384 MiB e proteção mínima de 1536 MiB livres antes de iniciar. Não reduzir o guard nem reiniciar o computador para passar. Regras práticas:

- usar limites explícitos adequados ao ensaio, um cluster e uma suíte por vez; não combinar Docker, emulador e compilações pesadas. O runner limitado a 2500 MiB pertence ao procedimento histórico, não é um passo automático da retomada;
- em 18/10 foi registrado um limite WSL de 3 GB em `%USERPROFILE%\.wslconfig`; isso é histórico, não uma confirmação do limite em vigor. Nesta retomada, o Docker informou cerca de 7,6 GiB disponíveis na VM. Conferir recursos efetivos antes de planejar a carga, sem reiniciar WSL/Docker ou alterar configurações do sistema nesta etapa;
- se o Docker Desktop não subir com "The file cannot be accessed by the system", renomear `%LOCALAPPDATA%\Docker\run` **e** `%LOCALAPPDATA%\docker-secrets-engine` e iniciar uma única vez. Nunca usar "Reset to factory defaults".

**Ambiente descartável e testes:**

```powershell
pnpm install --frozen-lockfile
pnpm setup:local      # só banco novo e descartável: inclui seed com contas de demonstração
pnpm test             # pacotes; o banco tem suíte própria
pnpm --filter @predioon/db exec node --import tsx --test --test-concurrency=1 test/*.test.ts
pnpm e2e:db up        # banco descartável próprio em 127.0.0.1:5446
pnpm test:e2e:chromium   # encerre o pnpm dev antes
```

A sequência do job de plataforma, as flags das suítes SQL038/SQL052 e os clusters próprios de backup estão em `.github/workflows/ci.yml` e [BACKUP_E_RESTAURACAO.md](BACKUP_E_RESTAURACAO.md). A ausência do Firefox e o bloqueio do WebKit por AppControl são limitações registradas nas rodadas anteriores; conferir a disponibilidade atual antes de iniciar a matriz. O bloqueio de cobrança do GitHub foi registrado em outubro. Na consulta de 03/11, o run `41106369658` da base `dba63dc` está em `startup_failure`; as consultas também retornaram zero check runs. Esses metadados não estabelecem a causa atual nem aprovam testes.

**Vídeos de demonstração:** `node scripts/record-portal-videos.mjs <pasta>` (portais, com servidores do Playwright via `pnpm exec playwright test -c playwright.videos.config.ts`) e `python scripts/record-app-video.py resident|operations <arquivo.mp4>` (emulador, salva também o logcat para conferir avisos Fabric).

## 6. O que falta

**Depois (24–25/10):** abertura pelo QR do totem (059). O tablet no portão mostra um QR que muda a cada hora; o morador lê pelo app, que confere no servidor antes de mostrar **Abrir**. É um adicional liberado por condomínio pela plataforma, e o síndico pode exigir o QR por portão ([ACESSOS](ACESSOS.md#abertura-pelo-qr-do-totem-059)). Rodadas por pacote no banco descartável 5446: API 135/135 nos módulos tocados, banco 275/297 (22 skips de laboratório) e migrações/notificações 61/61, ingestão 35/35, mobile 231/231, UI 108/108, api-client 118/118, Playwright Chromium 59/59 (acessos, QR, funcionalidades e smoke). **Pendentes:** leitura pela câmera num celular real, build Android com a `react-native-camera-kit` e build iOS.

**Depende do proprietário:**

- Resolver o acesso a runners do GitHub Actions, incluindo a pendência de cobrança registrada anteriormente; o run atual terminou em `startup_failure`, sem aceite de CI.
- Implantação real: VPS, domínio, TLS, chave do Resend e remetente, `MFA_ENCRYPTION_KEY`, segredos do Compose ([DEPLOY.md](DEPLOY.md)).
- Hardware real (gateways, sensores, portões) e homologação em condomínio.
- iOS: conta no Apple Developer Program e conta Expo para o primeiro build EAS com assinatura de distribuição e o TestFlight; ou um Mac emprestado para rodar `scripts/ios-mac/verify.sh`.
- Implementar e validar a MFA obrigatória da plataforma, conforme a decisão já registrada; decidir o prazo de retenção das leituras (sugestão histórica de 24 meses).
- Planos/assinaturas (deixados por último).

**Técnico, nesta máquina:**

- Ledger 067 corrigido em `1769caf`: RED preservado; notificações 54/54 e restores 2/2 passaram, com dados, ACL/RLS, seis roles e cleanup conferidos. Manter esses ensaios na regressão; não restaurar os testes antigos de 040.
- Rodar a suíte Playwright reorganizada por inteiro (`pnpm test:e2e:chromium`, depois Firefox), incluindo o `@smoke` e as specs novas, e registrar o resultado.
- Manter as provas dirigidas de 04/11 na regressão. API geral atual passou865/865; preservar esse baseline e completar builds e aceites operacionais (ingestão220/220 e consumidores118/130/236 já aprovados em suas fontes) antes de declarar aprovação ampla; não somar os 47 casos API nem os ensaios de ingestão como integrais.
- Ensaio de carga com a ingestão real (MQTT mensagem a mensagem).
- Teste intermitente conhecido: `password-recovery.test.ts` → "keeps two-step verification in place after a reset" falhou 1 vez na integral de 18/10 (a ativação da MFA não devolveu a chave) e passou 3/3 isolado; mesmo sintoma de limite de requisições compartilhado já visto antes. Investigar sem afrouxar o limite.
- Avisos Fabric: não se repetiram em quatro execuções no emulador em 18/10; a causa dos registros de outubro no CI segue sem demonstração.
