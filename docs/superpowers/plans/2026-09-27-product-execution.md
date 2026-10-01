# Execução da arquitetura de produto — Prédio ON

Base aprovada: [arquitetura](../specs/2026-09-27-arquitetura-produto-design.md). Execução em `codex/product-platform`, preservando o estado local anterior em cópia de trabalho isolada. Esta lista registra progresso real, sem considerar código não verificado como entregue.

## Sequência e aceite

- [x] 1. Contratos e cliente HTTP: separar DTOs e cliente portátil da UI, preservar consumidores web, testar renovação concorrente, troca de sessão, falhas de rede e fronteiras entre pacotes.
- [ ] 2. Identidade e RBAC: políticas por capacidade/condomínio; sessões com rotação atômica/revogação; migrations e RLS; vínculos/equipes; adaptação de consumidores e testes negativos de autorização.
- [ ] 3. Processamento durável: inbox/outbox, reserva/lease, workers por carga, recuperação após falhas, deduplicação e preservação da política de comandos físicos.
- [ ] 4. Domínios de produto: ativos e ordens de serviço, automações versionadas, planos/assinaturas e suporte com concessão explícita; API e gestão web integradas.
- [ ] 5. Aplicativos Morador/Operação: React Native sem Expo, armazenamento seguro, telas próprias por público, chamadas à API real, notificações e configurações nativas Android/iOS.
- [ ] 6. Implantação e operação: Compose, migrations registradas, credenciais restritas, backup/restauração, observabilidade, verificação de builds, regressão e documentação das dependências externas.

## Regras de execução

1. Reutilizar o banco, a API e os contratos existentes. Não reiniciar schema nem usar seed sobre dados reais.
2. Validar banco em container próprio de teste, porta local 5436, sem usar o banco de outros projetos.
3. Escrever testes de comportamento antes de mudanças de autenticação, autorização, filas e comandos; executar verificações apropriadas após cada integração.
4. Revisar conformidade com a especificação e qualidade do código; corrigir resultados relevantes antes de encerrar a etapa.
5. Novos papéis não podem receber acesso via comparação ordinal; ações continuam condicionadas ao condomínio/recurso e à política atual no servidor.
6. Não reenviar comandos físicos por políticas genéricas de retry. Chamadas a provedores não mantêm transações de jobs abertas.
7. Preservar os projetos web e compatibilidade de rotas durante a migração; nenhum aplicativo acessa diretamente banco/MQTT.
8. O aceite final distingue testes locais de builds móveis e integrações externas que exigem macOS, certificados, contas ou hardware.

## Registro inicial

- 27/09/2026: 159 arquivos alterados/novos anteriores foram copiados para a worktree; origem preservada.
- Verificação de tipos inicial dos oito pacotes executáveis existentes passou.
- Docker disponível. Ambiente Android/iOS e provedores externos serão verificados nas respectivas etapas.

## Evidências durante a execução

- Banco isolado `predioon-product-test`, porta 5436: schema atual, 12 scripts de infraestrutura e seed aplicados somente nesse ambiente.
- Regressão inicial: UI 23/23; API 102/103; ingestão 61/61. A falha da API era uma fixture dependente de telemetria prévia, ausente em um seed novo. O teste agora cria e limpa sua própria leitura; arquivo de segurança passou 10/10 após a correção.
- Snapshot SQL inicial gerado em `packages/db/drizzle/0000_baseline.sql` para preparar migrações controladas; ainda não substitui o fluxo de implantação e não foi aplicado em produção.
- Ambiente local sem Java, Android SDK ou ferramentas Apple detectáveis. Compilação nativa ainda não verificada; testes TypeScript não substituem builds Android/iOS.
- 28/09/2026: regressão da API passou 103/103 após corrigir a fixture. Os três painéis web compilaram; permanecem avisos de tamanho dos bundles, sem erro de compilação.
- Cliente compartilhado passou 25/25 testes e UI 28/28; revisão de conformidade aprovada após corrigir falha de rede durante leitura do corpo da resposta. Revisão de qualidade em andamento.
- Revisão final da etapa 1 aprovada: cliente 28/28, UI 28/28, fronteiras e seis verificações de tipos passaram. Correções adicionais impedem requisições antigas antes do envio após logout e bloqueiam imports de módulos nativos Node nos clientes. Nenhuma pendência nas duas revisões dessa etapa.
- Diagnóstico da autenticação atual confirmou duas renovações simultâneas aceitas para o mesmo refresh token em quatro de cinco tentativas. Falha corrigida na etapa 2A conforme evidências abaixo.
- 28/09/2026: migration `013-sessions.sql` aplicada no banco de teste isolado. Rotação concorrente, replay, logout por token consumido, revogação de todas as sessões, SSE revogado já aberto, conta inativa, expiração absoluta, isolamento por usuário e vínculos com janela de validade passaram em 9/9 testes. JWT EdDSA com `kid`, emissor/audience, rotação de chave pública e rejeição de HS/claims inválidos passaram em 4/4. API completa passou em 116/116; typecheck de API/DB passou.
- 28/09/2026: runner de migrations controlado passou em 5/5, incluindo lock concorrente, checksum, histórico divergente e rollback transacional.
- 28/09/2026: cliente SSE web passou a fechar a conexão ao erro, renovar a sessão pelo cliente HTTP e reconectar com o token atual; evita reconexão automática com JWT expirado. UI continuou em 28/28 e typecheck passou.
- 29/09/2026: fundação RBAC/tenancy aplicada no banco isolado via migration `014-rbac-tenancy.sql`, com reaplicação idempotente. Inclui catálogo explícito, blocos/unidades, equipes, concessões vigentes, suporte temporário e chaves compostas por condomínio. Novas APIs `/v1/tenancy` e `/v1/authorization` usam capacidades dentro da transação e auditoria atômica.
- 29/09/2026: regressão completa da API passou em **149/149**, sem testes ignorados, com `RUN_ACCESS_DB_TESTS=1` e `RUN_RBAC_DB_TESTS=1`. Inclui 17 testes PostgreSQL de RBAC, 9 do modelo compartilhado e 7 HTTP de tenancy. Foram reproduzidas e corrigidas a readmissão de integrantes revogados/expirados e a autorrevogação da concessão administrativa.
- 29/09/2026: UI passou em **32/32**, incluindo renovação/reconexão SSE, cancelamento ao desmontar, descarte de eventos antigos e backoff. Typechecks da API/UI e fronteiras de pacotes passaram. Revisões de conformidade e qualidade da fundação 2B aprovadas, sem achados pendentes no escopo.
- 30/09/2026: separação de credenciais da API aprovada nas revisões de conformidade e qualidade. Startup verifica a identidade autenticada do backend PostgreSQL, os papéis efetivo/de sessão, atributos, ownership e memberships; recusa owner mascarado e sanitiza erros dos três pools. A imagem Docker compilou e iniciou em produção com readiness e login reais, sem `DATABASE_URL` proprietária.
- 30/09/2026: scripts local/produção passaram a aplicar a migration 015 em uma transação. Probe no banco isolado reproduziu a persistência de uma função após falha sem transação e confirmou rollback com `--single-transaction`. Migration reaplicada com sucesso; typecheck de DB e sintaxe Bash passaram.
- 30/09/2026: pausa/retomada passou em **8/8** após corrigir uma fixture cujo relógio Windows precedia o horário de reativação PostgreSQL. Regressão completa da API passou em **162/162**, sem testes ignorados, com as duas flags de integração ativas. Testes PostgreSQL de identidade da conexão e configuração/provisionamento passaram em **7/7**, incluindo owner mascarado com `SET ROLE` e `SET SESSION AUTHORIZATION`.
- 30/09/2026: ingestão IoT passou em **61/61**, sem testes ignorados, após a separação dos entrypoints proprietário e restritos. Slice 2B.2 concluído; ingestão ainda usa a credencial proprietária e sua separação permanece no item 2B.5.
- 30/09/2026: primeiro recorte 2B.3 concluído: condomínios e funcionalidades usam capacidades atuais do banco; discovery por pessoa/equipe/recurso/suporte; políticas de cadastro separadas e auditoria sem fallback legado nas ações migradas. Migration `016` aplicada atomicamente somente no banco isolado. Revisões de conformidade e qualidade aprovadas.
- 30/09/2026: API completa passou em **176/176**, 26 suites e nenhum teste ignorado, com ambas as flags de integração ativas. Inclui 13 novos HTTP/DB e 10 testes do modelo RBAC. Os dez pacotes passaram na verificação de tipos e as fronteiras passaram. Os três painéis web compilaram; permanecem avisos de tamanho de bundle e anotações de dependências. Os demais módulos da etapa 2B.3 ainda aguardam migração.
- 30/09/2026: telemetria HTTP/RLS migrada por equipamento, incluindo suporte temporário sem acesso à configuração e negação de leitura privada ao administrador global sem concessão local. Migration `017` aplicada e reaplicada atomicamente somente no banco isolado. Projeção `telemetry:read-published` limita moradores ao nível percentual de água normalizado; configurações de pausa/retomada permanecem visíveis à autorização de telemetria mesmo após retirar `buildings:read`.
- 30/09/2026: regressão completa da API passou em **197/197**, 27 suites, sem testes ignorados, com as duas flags de integração. Inclui 21 testes novos de telemetria e EXPLAIN com 1.000 amostras confirmando execução do conjunto autorizado uma vez por consulta. Os dez typechecks e fronteiras passaram; revisões de conformidade e qualidade aprovadas. Próxima subentrega em execução: eventos SSE de telemetria; demais módulos e kinds SSE seguem pendentes.

## Divisão da etapa de identidade

- [x] 2A. Sessões e famílias de refresh: consumo atômico, detecção de reutilização, revogação imediata, listagem de sessões, JWT assimétrico e verificação de conta/vínculos atuais.
- [ ] 2B. RBAC e tenancy: catálogo de capacidades, concessões por condomínio/recurso, unidades/equipes, políticas RLS e credenciais de runtime restritas.
- [ ] 2C. Fluxos de identidade: cookies web/CSRF, MFA e verificação adicional para ações privilegiadas, convites/recuperação, limites de tentativas e adaptação dos clientes.

### Subentregas da etapa 2B

- [x] 2B.1. Fundação e API de tenancy: implementação, testes e revisões de conformidade/qualidade concluídos.
- [x] 2B.2. Credenciais da API: separar identidade e autorização do broker, retirar importação/conexão proprietária dos processos HTTP, manter verificações negativas de privilégios e fluxo de sessões.
- [ ] 2B.3. Migração dos módulos existentes: aplicar capacidades e RLS por domínio, incluindo seleção de condomínios, funcionalidades e eventos; manter testes de revogação, suporte e acesso a recursos próprios.
- [ ] 2B.4. Gestão web integrada: cadastros de unidades/equipes/vínculos e seleção de escopo autorizada pelo servidor.
- [ ] 2B.5. Credenciais de ingestão e workers: conceder somente as operações de cada carga, junto da separação durável da etapa 3.

A migração por domínio da etapa 2B.3 está detalhada em [sequência e critérios de aceite](2026-09-29-rbac-domain-migration.md).

## Evidência complementar de eventos — 30/09/2026

- Eventos SSE de telemetria concluídos e aprovados nas revisões de conformidade e qualidade. Treze testes novos verificam projeção publicada, escopo por equipamento e revogação no stream aberto. Teste dirigido 29/29; tipos da API e fronteiras passaram.
- Regressão completa API 210/210, 28 suites, sem skips ou cancelamentos. Uma execução anterior cancelou 13 casos durante abertura do LISTEN PostgreSQL por CONNECT_TIMEOUT; execução dirigida e repetição integral da mesma fonte/DSNs passaram. A causa ambiental não foi confirmada e não foi adicionada tolerância ao teste.
- A etapa 2B.3 permanece aberta: alertas são o próximo recorte; equipamentos, gateways, monitoramento, dashboards, outros domínios e os demais kinds SSE continuam pendentes.
- Alertas HTTP/RLS iniciados: 15 testes RED reproduziram falhas do comportamento antigo. O agente foi interrompido pelo limite de uso antes de completar handlers/catalogo, aplicar migration 018 ou executar GREEN/revisões. Código parcial preservado e ponto de retomada documentado no [plano de alertas](2026-09-30-alert-capabilities.md); a evidência 210/210 anterior não valida essas mudanças parciais.
- Commit/push autorizados pelo usuário: checkpoint `357756d` publicado em `origin/codex/product-platform`, com drafts de alertas mantidos fora do commit. Verificação do conjunto publicado: API 210/210, cliente HTTP 30/30, UI 32/32, dez typechecks e fronteiras passaram. A primeira verificação do estado local parcial encontrou duas divergências do catálogo por `alerts:resolve`; a repetição com o catálogo exato do checkpoint passou. Execução de alertas retomada após o push; as etapas totais permanecem abertas.
- Alertas HTTP/RLS implementados e aprovados nas duas revisões: 21 testes novos, dirigido 48/48. A revisão identificou e corrigiu uma leitura de funcionalidades que podia percorrer o histórico; os planos reais de settings/runtime agora têm zero scans de histórico, e a autorização pontual usa alerts_pkey. O teste de captura dos planos também passou com .local inicialmente ausente. SSE de alertas em execução; regressão integral conjunta ainda pendente.
- Conjunto HTTP/SSE de alertas verificado pelo agente principal: API **248/248**, 30 suites e nenhum skip/cancelamento; dez verificações de tipos e fronteiras passaram. SSE acrescenta 17 testes reais com NOTIFY e conexões HTTP, dirigido 46/46, conformidade e qualidade aprovadas. Descoberta de condomínio por pertencimento real do recurso é o próximo recorte corretivo, antes dos demais módulos de 2B.3.
- Commit `30625ae` enviado a origin/codex/product-platform: alertas HTTP/SSE concluídos, com estado local e remoto conferidos. Recorte corretivo de descoberta básica 019 em execução no banco isolado; as demais etapas continuam abertas.
- Descoberta básica 019 concluída e aprovada nas duas revisões: concessões em recurso ausente/estrangeiro não revelam cadastro ou estado básico; validador owner-only, mapeamentos reais e autorização vigente preservados. Dirigido 73/73, incluindo 18 provas novas; regressão integral do agente principal **266/266**, 31 suites, sem skips/cancelamentos. Tipos da API e fronteiras passaram. Policies, grants, catálogo e demais helpers permaneceram idênticos. [Equipamentos/gateways](2026-09-30-equipment-capabilities.md) são o próximo recorte de 2B.3.
- Commit `2db1e8c` publicado e conferido no remoto: correção 019 integrada. Equipamentos/gateways 020 em execução, reutilizando devices:read/devices:configure; SSE de status e consumers web permanecem entregas dependentes.
- Equipamentos/gateways 020 concluídos e aprovados nas duas revisões do escopo ampliado. Dirigido **117/117**, nove suites; API integral do agente principal **288/288**, 32 suites, sem skips/cancelamentos. Tipos da API, fronteiras e diff-check passaram; reaplicação atômica e limpeza verificadas. A primeira integral encontrou fixtures antigas incompatíveis e revelou dependência real da abertura residencial em inventário privado; uma projeção de seis campos de hardware vinculada ao portão preserva abertura e regras de comando sem conceder configuração ao morador. Não altera dispatcher/QoS/replay.
- Um probe PostgreSQL reproduziu a validade indevida de permissões após vencimento dentro de uma transação bloqueada, pois now() conserva o horário inicial. O [corretivo 021](2026-09-30-authorization-time-windows.md) é a próxima entrega. [Eventos de equipamentos/funcionalidades 022](2026-09-30-equipment-events-capabilities.md) vêm na sequência; demais domínios, web, identidade, workers, mobile e implantação continuam abertos.
- Commit `482d8d9` publicado e conferido em origin/codex/product-platform: equipamentos/gateways e compatibilidade de disponibilidade residencial integrados. Corretivo de vigência 021 em execução no banco isolado; demais etapas totais permanecem abertas.
- Corretivo 021 concluído e aprovado nas duas revisões: autorização usa instante por statement e revalidação após os locks controlados; helpers históricos são owner-only. Virada semanal revelou rescans por chunk na policy de telemetria, corrigidos por mapa escalar de pares ordenados; fixture própria preserva um helper/um loop/1002 linhas em dois chunks. Dirigido inicial 154/154; após corrigir a aquisição/limpeza dos testes de lock, novo arquivo 28/28 e dirigido 92/92. API integral final do agente principal **316/316**, 33 suites, sem skips/cancelamentos; tipos da API, fronteiras e diff-check passaram. Catálogo/grants/assinaturas preservados fora das três policies autorizadas e cleanup sem fixtures/transações/locks. [Eventos 022](2026-09-30-equipment-events-capabilities.md) e [monitoramento 023](2026-09-30-monitoring-capabilities.md) vêm na sequência; a etapa 2B.3 e o plano total permanecem abertos.
