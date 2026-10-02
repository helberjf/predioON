# Continuidade do Prédio ON

Atualizado em **02/10/2026**, horário de São Paulo. Este é o ponto de retomada em outro computador ou outra sessão. **O plano completo ainda não terminou.** Resultados de uma versão não aprovam automaticamente mudanças posteriores.

Repositório: <https://github.com/helberjf/predioON>. Linha de trabalho autorizada: `main`. A API publicada até **`cde21f1`** passou na nova integral de **632 testes**. **`ac28caf`** acrescentou capturas de inicialização iOS ao CI; o resultado nativo ainda precisa ser conferido. As migrations publicadas terminam em **035**. A036 está em rascunho recuperável; a037 tem somente um plano, sem implementação.

## 1. Instruções permanentes do proprietário

- Continuar até concluir as implementações dos apps e websites, testes e evolução descritos na arquitetura aprovada.
- Fazer commits pequenos no padrão Conventional Commits, por exemplo `fix:`, `feat:`, `test:` e `docs:`, com push frequente na `main` depois de cada incremento verificado.
- Executar testes de API/banco/ingestão/clientes, Playwright e testes nativos apropriados. Não desativar proteções nem enfraquecer asserções para conseguir aprovação.
- Reescrever a documentação completa ao concluir o produto; manter desde já este documento e o tracker atualizados.
- Manter sugestões em [MELHORIAS_E_EVOLUCOES.md](MELHORIAS_E_EVOLUCOES.md).
- **Não reiniciar o computador nesta sessão.** Nenhum reboot foi executado pelo agente. Reiniciar um processo de teste não é reiniciar o computador.
- Ao terminar, abrir os três portais e os apps Morador/Operação neste computador e entregar cinco gravações completas, separadas, com dados fictícios. Também foram solicitadas imagens de Android, iOS e web durante o andamento.

## 2. Estado das etapas

| Etapa da arquitetura | Estado | O que falta para encerrá-la |
| --- | --- | --- |
| 1. Contratos e cliente HTTP | Concluída no escopo original | Preservar regressões durante novas integrações. |
| 2. Identidade e RBAC | Parcial, com muitos domínios migrados | Concluir auditoria/administrativos legados e consumidores; MFA, convites, recuperação e demais fluxos de identidade. |
| 3. Processamento durável | Pendente | Inbox/outbox, consumidores separados, leases, retomada, deduplicação, dead letter e credenciais específicas. Nunca repetir atuação física automaticamente. |
| 4. Evolução dos domínios | Pendente para os novos módulos | Ativos, ordens de serviço, automações versionadas, planos/assinaturas e suporte com concessão explícita, com API/UI e testes. |
| 5. Apps Morador/Operação | Parcial | Estabilizar jornadas nativas, integrar novos módulos/identidade, notificações, execução iOS e homologação. |
| 6. Implantação e operação | Parcial | Regressores finais verdes, operação durável, integrações externas, implantação real, documentação final e demonstrações. |

O código existente já oferece monitoramento, alertas, acessos, vagas, avisos, chamados, reservas e financeiro. Isso não significa que os novos módulos da etapa4 nem o aceite final estejam concluídos.

Documentos de referência: [arquitetura aprovada](superpowers/specs/2026-09-27-arquitetura-produto-design.md), [tracker completo](superpowers/plans/2026-09-27-product-execution.md), [sequência RBAC](superpowers/plans/2026-09-29-rbac-domain-migration.md) e [inventário das apresentações](superpowers/plans/2026-10-02-presentation-coverage.md). Entradas antigas desses documentos são históricas; o estado mais recente está aqui e nos planos específicos.

## 3. Entregas publicadas mais recentes

| Commit | Entrega |
| --- | --- |
| `ff3e528` | Estacionamento033 por condomínio/vaga/sensor, com contagem concorrente e permissão atual. |
| `fc5f53a` | Minhas sessões nos três portais, com revogação vinculada à geração da identidade. |
| `ccac601`, `ed21b67`, `6e82ce6` | Jornada Android de reservas; comentários aguardam confirmação; diálogo AndroidX reconhecido pelos elementos reais. |
| `1c80551` | Acesso físico034: leitura/gestão/pedido/histórico separados, revalidação antes do despacho, idempotência e nenhuma repetição automática. |
| `727264e` | Login035: limites persistentes compartilhados por conta/rede, segredo próprio, corpo limitado, falha fechada e proxy de produção restrito. |
| `cfd63af` | Verificador preliminar de AVD limpo. Ainda não incorpora cache aos testes autenticados. |
| `8e0be69` | Fixture de assinatura em produção compatível com a chave obrigatória de limite de login. |
| `bd52637` | Atualização de leitura web pendente passa a executar uma nova leitura ao terminar; job Playwright usa imagem oficial. |
| `42f2130` | Navegação móvel reconhece concessão de acesso por recurso; contrato HTTP real e CI. |
| `3e9c648` | Preparação de fixtures HTTP respeita429/Retry-After com limite de tentativas, sem mudar a política de produção. |
| `4c349b1` | Documento de continuidade e checkpoint portátil de 24 rascunhos, com restauração verificada. |
| `cde21f1` | Expectativas de equipamentos atualizadas para a autorização física034; 50 dirigidos aprovados. |
| `ac28caf` | CI iOS passa a abrir o build Release em simulador novo, verificar dois processos e preservar imagens. Resultado real em conferência. |

## 4. Evidências e falhas conhecidas

| Verificação | Evidência e limite |
| --- | --- |
| Plataforma anterior033 | [CI c106a78](https://github.com/helberjf/predioON/actions/runs/36965837362): API570/570, banco26/26, ingestão68/68, cliente48/48, UI64/64, mobile51/51, tipos/builds/imagens aprovados. É histórico, não aprovação da fonte atual. |
| Acesso034 | API71/71, ingestão83/83 e outros46 dirigidos; permissões, corridas de locks, expiração, ACK e ausência de replay. |
| Login035 | 24 próprios, 29 dirigidos de autenticação e26 de banco/restauração. Restauração real verificou44 tabelas e35 migrations, RLS/ACL/helpers/dados. Proxy Caddy real também testado. |
| Integral Linux727264e | **602/615**, 13 falhas. Uma fixture de chave corrigida em8e0be69; duas expectativas antigas de equipment-capabilities corrigidas no checkpoint abaixo; duas faltas de dependência na cópia Linux corrigidas; oito429 de preparação de estacionamento tratados em3e9c648. Não somar dirigidos para declarar uma integral verde. |
| Após ajuste das fixtures | **3/3** próprios do helper e **60/60** dirigidos Linux de estacionamento/limites/monitoramento/lifecycle, sem skips; tipos API aprovados. |
| Equipamentos e acesso após correção das expectativas | **50/50** dirigidos Linux, sem skips, sobre a fonte publicada 4c349b1 mais o ajuste dos testes. A consulta mínima admite concessões atuais no dispositivo/gateway, nega administrador global sem concessão local e volta a negar após revogação. As provas de isolamento, validade e inventário privado foram preservadas. |
| Nova integral API035 | **632/632**, 50 suites, zero falhas/cancelamentos/skips, em Linux com PostgreSQL/Timescale real e ambas as flags de integração ativas. Fonte de API publicada em cde21f1, sem rascunhos036. Duração13min25s; log local work/api035-regression-final.log. Esse resultado substitui a integral anterior da API, mas não comprova ingestão, navegador ou alterações posteriores. |
| Mobile42f2130 | **59/59** unitários e **1/1** contrato real de navegação de portões; tipos e bundles dos dois apps aprovados. A descoberta básica exige buildings:read no mesmo recurso, além de gates:read; não foi criada concessão ampla implícita. |
| Playwright anterior publicado | [CI42f2130](https://github.com/helberjf/predioON/actions/runs/36975943741): **54/153**, 99 falhas. O log confirma429 na conta compartilhada admin de preparação. As fixtures foram corrigidas para identidades exclusivas por cenário, sem remover o limitador. |
| Playwright com identidades isoladas | **57/57** combinações de cookies, isolamento e portais nos três motores, sem retries/skips, contra fonte publicada ac28caf/SQL035 e ajuste das fixtures. Tipos E2E aprovados. A matriz integral de153 está em execução e tem resultado independente. |
| Web AccessPanel em rascunho | Quatro primeiros cenários Chromium passaram. Ampliação teve5 aprovados/2 falhas de ciclo de vida; correções posteriores ainda precisam de GREEN. A rodada seguinte14falhas parou na criação das fixtures porque fonte já tinha colunas036 e banco não; isso é incompatibilidade de snapshot, não prova de falha em cada tela. |
| Auditoria036 em rascunho | Snapshot integrado034/035/036 passou **98/98**, sem skips. Consulta global entre30mil eventos privados e20globais caiu para21ms com índice; união global/local autorizada50linhas mediu87ms. Ainda faltam correção de reaplicação, revisões finais, UI e Playwright. |
| Android autenticado | Há percursos anteriores completos com19/21 fases por app; histórico e limites em scripts/android-auth-smoke/README.md. Não equivalem a homologar todos os domínios. |
| Android reservas42f2130 | [CI36975943695](https://github.com/helberjf/predioON/actions/runs/36975943695) aprovado, artefato11212879728 conferido: **23 fases**, criação/cancelamento/pedido pendente/retirada de calendário, provas no banco e buffer de crash vazio. Capturas de confirmação e revogação inspecionadas. Reserva estrangeira permaneceu intacta. |
| Android domínios | [CI42f2130](https://github.com/helberjf/predioON/actions/runs/36975943742), artefato11213644516 conferido: oito fases de Morador passaram e Operação não começou. Falhou ao localizar “Ver lançamentos (1)”. Imagens/XML mostram carregamento financeiro; o proxy recebeu respostas200 e o log do app contém MissingViewState do renderer. A causa ainda não está demonstrada; não classificar esta execução como ANR de launcher nem corrigir apenas aumentando espera sem investigar. |
| Builds nativos42f2130 | Android e [iOS](https://github.com/helberjf/predioON/actions/runs/36975943839) terminaram com sucesso. iOS é build unsigned para simulador; execução, screenshots e homologação iOS ainda não estão comprovadas. |

## 5. Rascunhos preservados fora do código ativo

O [patch de recuperação](continuidade/2026-10-02-em-andamento.patch) contém **24 arquivos** em andamento, baseados no commit`3e9c6485edc9558a3c49a592cfdce4258694e80f`. O [manifesto](continuidade/2026-10-02-manifesto.json) inclui SHA-256 do patch e de cada arquivo normalizado para LF. A restauração foi realmente aplicada sobre um arquivo Git limpo da base e os24 hashes conferiram.

Esse patch é uma cópia de trabalho revisável, **não uma versão aprovada para implantação**. Sua presença em docs não executa migrations, testes ou workflows. Nesta máquina os rascunhos continuam aplicados na árvore local; não aplicar o patch novamente sobre eles.

| Rascunho | Estado ao salvar | Próximo passo |
| --- | --- | --- |
| Auditoria036 | SQL, DTO/schema, catálogo, rota, teste, ordem atômica da autorrevogação e ajuste do teste de suporte.98 dirigidos no snapshot integrado. | A reaplicação volta a inserir grants padrão apagados em role_permissions, contrariando o plano. Reproduzir e corrigir sem ampliar autoridade; conferir producers034, ACLs, restore e criar consumidor comum com paginação/retry. |
| AccessPanel web | Store em memória por sessão/prédio/gate, confirmação explícita, preflight atual, editor exato e sete cenários E2E. | Executar UI e API/SQL compatíveis no mesmo snapshot; provar logout/background e navegação nos três motores, então publicar. |
| Snapshot AVD | `avd_snapshot.py`, seus testes e workflowandroid-avd.yml com dois runners. | Verificar testes, fingerprint/configuração real, snapshot parado, fresh ADB, boot_id e nenhuma chave privada no cache. Executar CI antes de integrar aos percursos autenticados. |
| Senha037 | **Somente plano Markdown**. | Escrever RED, implementar confirmação atual/revogação atômica e locks conta→família. Não anunciar endpoint ou migration como existentes. |

## 6. Retomar em outro computador

Primeiro clone a main publicada. É possível trabalhar normalmente sem recuperar os rascunhos; para continuar exatamente esses incrementos, use a seção seguinte.

```powershell
git clone https://github.com/helberjf/predioON.git
cd predioON
git switch main
git pull --ff-only
git status --short
```

Leia este documento, a arquitetura e o tracker. Instale Node24 e pnpm**10.17.1**, Git e Docker Desktop/Compose. No Windows, WSL2 é necessário para o backend Linux do Docker. O navegador já autenticado não substitui a autenticação Git nessa nova máquina; use o fluxo normal do gerenciador de credenciais, sem registrar tokens em arquivos do repositório.

### Recuperar os rascunhos com verificação

Em clone limpo compatível com o checkpoint:

```powershell
Get-FileHash docs/continuidade/2026-10-02-em-andamento.patch -Algorithm SHA256
git apply --check docs/continuidade/2026-10-02-em-andamento.patch
git apply docs/continuidade/2026-10-02-em-andamento.patch
git diff --check
git status --short
```

SHA-256 esperado: `244d48968fcf5d0d773dfd18a5281e58c56019635d8de091b9629e2d398daf3d`. Se a main avançou e `--check` falhar, não forçar, sobrescrever arquivos ou reaplicar trechos às cegas. Abra uma cópia de trabalho na base exata e aplique nela, preservando o clone atual:

```powershell
git worktree add --detach ../predioON-checkpoint 3e9c6485edc9558a3c49a592cfdce4258694e80f
git -C ../predioON-checkpoint apply --check ../predioON/docs/continuidade/2026-10-02-em-andamento.patch
git -C ../predioON-checkpoint apply ../predioON/docs/continuidade/2026-10-02-em-andamento.patch
```

Nesse segundo caminho, a fonte recuperada é para revisão/integração; publicar os incrementos verificados na main continua sendo a orientação do proprietário.

### Preparar ambiente descartável

```powershell
pnpm install --frozen-lockfile
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose version
pnpm setup:local
pnpm dev
```

`setup:local` é para **banco local novo e descartável**, pois inclui seed que redefine credenciais demonstrativas. Não usar seed/reset para atualizar banco real. A main neste checkpoint aplica001–035; restaurar o patch acrescenta036, que ainda precisa revisão antes de aplicar. Nunca iniciar a fonte Drizzle036 contra banco035 e interpretar o erro de coluna ausente como bug de cada módulo.

Portas locais padrão: banco5434, API3000, administração5173, síndico5174, morador5175. O `.env.example` e [README](../README.md#instalação-local) contêm contas exclusivamente de demonstração. A API deve usar os três DSNs restritos; o DSN proprietário serve para migrations/fixtures/ingestão enquanto a separação desta última permanece pendente.

### Verificações a reproduzir

Executar integrações somente em banco descartável preparado conforme [MIGRATIONS.md](MIGRATIONS.md). `DATABASE_URL`, `DATABASE_URL_APP`, `DATABASE_URL_IDENTITY` e `DATABASE_URL_BROKER_AUTH` precisam apontar para o mesmo banco de teste. API/ingestão exigem as flags reais de integração:

```powershell
$env:RUN_ACCESS_DB_TESTS='1'
$env:RUN_RBAC_DB_TESTS='1'
pnpm typecheck
pnpm check:boundaries
pnpm test
pnpm build
$env:RUN_MOBILE_DB_TESTS='1'
pnpm --filter @predioon/mobile exec tsc --project test/tsconfig.integration.json
pnpm --filter @predioon/api exec tsx --test ../../packages/mobile/test/reservation-calendar.integration.mts
pnpm --filter @predioon/api exec tsx --test ../../packages/mobile/test/resident-access.integration.mts
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
```

Antes do Playwright, ajustar também o DSN proprietário usado pelas fixtures e seguir as restrições de `e2e/database-target.ts`. Ele aceita loopback local; no container de CI, apenas o serviço explicitamente autorizado. Para WebKit, esta máquina Windows teve DLL bloqueada pelo AppControl; usar o runnerLinux/imagem`mcr.microsoft.com/playwright:v1.63.0-noble`, sem desativar a proteção do sistema.

Banco/backup: seguir [BACKUP_E_RESTAURACAO.md](BACKUP_E_RESTAURACAO.md), incluindo restauração real, não apenas geração de arquivo. Workflows versionados explicam provisionamento, flags, SDKs e comandos exatos de cada plataforma. Não afirmar sucesso com testes ignorados ou somente typecheck.

## 7. Ordem prática para continuar

1. Conferir a main e recuperar os rascunhos se necessário; manter API/schema/SQL de uma mesma versão por snapshot de teste.
2. Preservar a integral API035 aprovada em632/632 e acompanhar o CI da fonte publicada. Rascunhos036 e futuras alterações exigem nova validação própria.
3. Conferir a matriz Playwright completa após isolar as contas por cenário em `e2e/fixtures.ts`. Os57 dirigidos passaram; nenhuma proteção de login foi desativada.
4. Fechar o AccessPanel com21combinações (sete cenários × três motores), tipos e testes de sessão. Publicar só esse incremento.
5. Corrigir reaplicação036, conferir98 dirigidos e ampliar regressão. Implementar auditoria web/paginação/retry/isolamento e seus E2E; revisar e publicar036.
6. Diagnosticar a falha financeira de Android e conferir capturas da execução iOS36998776108; concluir ensaio de snapshot limpo. Conservar ANR/crash como falha e não repetir mutações para mascarar erros.
7. Completar regressão de ingestão/banco/clientes/web com a fonte publicada exata e repetir API quando houver mudanças. A integralAPI035 está aprovada; a plataforma inteira ainda não tem aceite final.
8. Prosseguir identidade037 e os itens2C/3/4/5/6 da arquitetura. A037 ainda não deve ser adicionada ao runner antes da036.
9. Entregar imagens reais solicitadas, depois concluir documentação, abertura local e cinco vídeos conforme inventário. Capturas isoladas não substituem vídeos nem homologação.

## 8. O que não acompanha o clone

`.local`, `work`, toolchains, containers, volumes Docker, `.env`, tokens, keystores, artefatos nativos e capturas/vídeos não ficam no Git. O patch contém somente código, testes, workflow e planos, sem esses arquivos. Recriar bancos descartáveis pelos scripts; não é necessário transportar os volumes desta máquina.

Os artefatos de CI têm retenção curta (em geral3–7dias): baixar evidências importantes enquanto disponíveis e guardar fora do repositório. Nesta máquina os entregáveis ficam na pasta`outputs` ao lado do clone. As imagens Android disponíveis são de emulador real, com dados fictícios; imagens iOS e novas capturasweb ainda estão em preparação. Nenhum dos cinco vídeos finais foi produzido.

Credenciais de produção, certificados Apple/Android, FCM/APNs, domínio/TLS público e controladores físicos não foram configurados/homologados como parte do aceite atual. Essa lista não impede continuar implementando e testando localmente; define quais resultados não podem ser afirmados ainda.

## 9. Prompt sugerido para a próxima sessão

> Continue o Prédio ON pela main. Leia docs/CONTINUIDADE.md, a arquitetura aprovada e o tracker. Confira a fonte publicada e o patch/manifesto antes de recuperar os24arquivos em andamento. Priorize falhas de regressão, fixtures Playwright, AccessPanel e auditoria036; depois continue identidade e demais etapas. Faça Conventional Commits e push na main após cada incremento verificado. Não reinicie o computador. Preserve as limitações documentadas e não declare o projeto completo antes dos testes, documentação, abertura dos cinco sistemas e vídeos solicitados.
