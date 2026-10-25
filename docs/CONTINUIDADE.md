# Continuidade do Prédio ON

Atualizado em **24/10/2026**, horário de São Paulo. Leia este arquivo primeiro ao retomar, em qualquer computador. O histórico anterior está em [continuidade/historico-ate-2026-10-17.md](continuidade/historico-ate-2026-10-17.md); a entrega atual de entrada pública, testes e VPS está em [VERIFICACAO_2026-10-24.md](VERIFICACAO_2026-10-24.md).

**Situação:** o produto está implementado e verificado localmente, **sem implantação e sem aceite de produção**. Base desta rodada: **main `c53117d6`**, migrations **001–058**. Planos/assinaturas ficaram por último, por decisão do proprietário, e não foram feitos.

## 1. Instruções permanentes do proprietário

- Commits pequenos em Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`), com push na `main` depois de cada incremento verificado.
- Rodar os testes de banco, API, ingestão, clientes, Playwright e nativos apropriados. **Nunca** desativar proteções nem enfraquecer asserções para aprovar.
- **Não reiniciar o computador.** Esta máquina tem 16 GB e pouca memória livre: carga excessiva já coincidiu com um reinício. Ver a seção 5.
- Nunca rodar seed/reset numa instalação existente. A demonstração 037 fica intacta.
- Nunca repetir automaticamente comandos de acesso físico; sem fallback para a conexão owner; não editar as migrations 001–051 já publicadas.
- Não contornar o bloqueio salvo da galeria 8765.
- Sugestões vão para [MELHORIAS_E_EVOLUCOES.md](MELHORIAS_E_EVOLUCOES.md). Imagens conferidas entram nos commits, com origem e limites, via [IMAGENS_DOS_SISTEMAS.md](IMAGENS_DOS_SISTEMAS.md).
- Ao terminar: abrir os três portais e os apps Morador/Operação e entregar cinco gravações separadas com dados fictícios. **Entregues em 18/10:** [docs/videos](videos/README.md).

## 2. O que existe

| Parte | O que faz | Referência |
| --- | --- | --- |
| Portal da administração | Carteira de condomínios e clientes, gateways e equipamentos, funcionalidades, usuários, acesso de suporte, auditoria, **saúde dos serviços** (058) | [FUNCIONALIDADES.md](FUNCIONALIDADES.md) |
| Portal do síndico | Água, energia, sensores, alertas, ocorrências, avisos, áreas e reservas, portões e vagas (desligados por padrão), transparência, ordens de serviço, ativos, **automações por alerta e programadas** (045/057), unidades/equipes/permissões, convites, acesso de suporte | [GESTAO_TRANSPARENTE.md](GESTAO_TRANSPARENTE.md), [ORDENS_DE_SERVICO.md](ORDENS_DE_SERVICO.md), [ATIVOS.md](ATIVOS.md), [AUTOMACOES.md](AUTOMACOES.md) |
| Portal do morador | Avisos, ocorrências, reservas, transparência, acessos e vagas, consumo liberado pelo síndico, perfil e sessões, convite | [CONSUMO_E_ANALISE.md](CONSUMO_E_ANALISE.md) |
| App Morador (React Native) | Avisos, solicitações, reservas, transparência, acessos, consumo, troca e recuperação de senha, MFA na entrada, **aceite de convite** | [packages/mobile/README.md](../packages/mobile/README.md) |
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
| 2. Identidade e RBAC | Concluída: capacidades em todos os módulos (2B.3, 054), gestão web integrada (2B.4), convites, MFA, recuperação e confirmação recente (2C, 055). **Decisão do proprietário:** tornar a MFA obrigatória para a administração da plataforma (exige cadastro forçado no primeiro acesso). |
| 3. Processamento durável | Outbox e worker de notificações (038), ingestão sem owner (052), garantias de telemetria (048). A fila separada da inbox foi adiada conscientemente ([INBOX_DECISOES.md](INBOX_DECISOES.md)). |
| 4. Domínios | Ativos (044), ordens de serviço (043), automações por alerta e programadas (045/057), suporte com concessão explícita (053). **Planos/assinaturas: não iniciado**, por decisão. |
| 5. Apps | Funcionais e testados (224 testes); jornadas Android aprovadas em CI até o bloqueio da conta; percorridos no emulador em 18/10 (vídeos), sem avisos Fabric no logcat. Caminho iOS preparado em 18/10: EAS Build/Submit sem Expo SDK e `scripts/ios-mac/verify.sh` para um Mac emprestado. **Pendentes:** primeiro build iOS assinado, iOS autenticado e homologação em aparelhos. |
| 6. Implantação e operação | Artefatos prontos e ensaiados localmente (Compose, healthchecks, backup/restauração, retenção, saúde dos serviços). **Sem implantação real.** |

## 4. Últimas releases (17/10)

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

**Provas da última rodada (HEAD, clusters novos):** banco 301/303 (2 skips de backup, cobertos pelo teste próprio), api-client 118/118, UI 108/108, mobile 224/224, API 827/827, ingestão 204/204; SQL052 73/73; serviços restritos 114/114; restauração 2/2 três vezes; ingestão real com broker 12/12; Playwright Chromium completo 117/117. [Evidência](evidencias/releases-055-058-2026-10-17.json).

## 5. Como retomar e testar nesta máquina

**Memória:** antes de qualquer etapa pesada, confira a memória livre. O VM do Docker (vmmemWSL) não tem limite e chega a ~5 GB; com outros programas abertos a memória livre já caiu a 0,3 GB. Regras práticas:

- regressões pesadas rodam **dentro do container runner com memória limitada** (`docker update --memory 2500m`), um cluster por vez;
- desde 18/10 o WSL está limitado a 3 GB por `%USERPROFILE%\.wslconfig`, a pedido do proprietário (apagar o arquivo e rodar `wsl --shutdown` volta ao padrão). Mesmo assim, emulador e Docker juntos só cabem com navegador, VS Code e outros apps pesados fechados, inclusive da bandeja;
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

A sequência do job de plataforma, as flags das suítes SQL038/SQL052 e os clusters próprios de backup estão em `.github/workflows/ci.yml` e [BACKUP_E_RESTAURACAO.md](BACKUP_E_RESTAURACAO.md). Firefox não está instalado e o WebKit é bloqueado pelo AppControl nesta máquina. O CI do GitHub termina em `startup_failure` desde outubro por cobrança da conta; só o proprietário resolve.

**Vídeos de demonstração:** `node scripts/record-portal-videos.mjs <pasta>` (portais, com servidores do Playwright via `pnpm exec playwright test -c playwright.videos.config.ts`) e `python scripts/record-app-video.py resident|operations <arquivo.mp4>` (emulador, salva também o logcat para conferir avisos Fabric).

## 6. O que falta

**Depende do proprietário:**

- Liberar a cobrança do GitHub Actions (CI bloqueado).
- Implantação real: VPS, domínio, TLS, chave do Resend e remetente, `MFA_ENCRYPTION_KEY`, segredos do Compose ([DEPLOY.md](DEPLOY.md)).
- Hardware real (gateways, sensores, portões) e homologação em condomínio.
- iOS: conta no Apple Developer Program e conta Expo para o primeiro build EAS assinado e o TestFlight; ou um Mac emprestado para rodar `scripts/ios-mac/verify.sh`.
- Decidir: MFA obrigatória para a plataforma; prazo de retenção das leituras (sugestão de 24 meses).
- Planos/assinaturas (deixados por último).

**Técnico, nesta máquina:**

- Rodar a suíte Playwright reorganizada por inteiro (`pnpm test:e2e:chromium`, depois Firefox), incluindo o `@smoke` e as specs novas, e registrar o resultado.
- Ensaio de carga com a ingestão real (MQTT mensagem a mensagem).
- Teste intermitente conhecido: `password-recovery.test.ts` → "keeps two-step verification in place after a reset" falhou 1 vez na integral de 18/10 (a ativação da MFA não devolveu a chave) e passou 3/3 isolado; mesmo sintoma de limite de requisições compartilhado já visto antes. Investigar sem afrouxar o limite.
- Avisos Fabric: não se repetiram em quatro execuções no emulador em 18/10; a causa dos registros de outubro no CI segue sem demonstração.
