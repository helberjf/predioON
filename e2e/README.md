# Testes E2E com Playwright

A suíte abre os três portais (administração, condomínio, morador) em Chromium, Firefox e WebKit, contra a API real e os builds de produção (`vite build` + `vite preview`), num banco PostgreSQL/TimescaleDB **descartável**. Nada aqui toca dados reais. O histórico de execuções e decisões anteriores está em [HISTORICO.md](HISTORICO.md).

## 1. Preparar a máquina (uma vez)

```powershell
pnpm install
pnpm exec playwright install chromium firefox webkit
pnpm e2e:db up
```

`pnpm e2e:db up` cria o contêiner `predioon-playwright-db-5446` em `127.0.0.1:5446` (imagem `timescale/timescaledb:2.17.2-pg16`, a mesma do CI), aplica bootstrap, migrations, credenciais restritas e o seed com portões e vagas ligados. Depois grava as sete `DATABASE_URL*` em `.local/e2e.env`, que o `playwright.config.ts` e as fixtures leem sozinhos.

- `pnpm e2e:db reset` recria o banco do zero; `pnpm e2e:db down` apaga o contêiner; `pnpm e2e:db status` mostra o estado.
- Outra porta: `$env:E2E_DB_PORT=5447; pnpm e2e:db up`. Se a porta estiver ocupada, ou se já existir um contêiner com esse nome que o script não criou (ele confere um label de posse), o script para em vez de usar ou apagar o banco de outra sessão.
- Memória: Docker + API + três portais + um navegador pedem de 4 a 5 GB livres. Confira antes (`Win32_PerfFormattedData_PerfOS_Memory`) e prefira rodar um navegador por vez nesta máquina.

## 2. Rodar

| Comando | O que faz |
|---|---|
| `pnpm test:e2e` | Suíte completa, nos três navegadores |
| `pnpm test:e2e:chromium` | Suíte completa só no Chromium (mais rápido no dia a dia) |
| `pnpm test:e2e:smoke` | Abre **todas as páginas** dos três portais (`@smoke`) |
| `pnpm test:e2e e2e/specs/auth` | Uma área inteira |
| `pnpm test:e2e --grep "@permissions"` | Só os testes marcados com a tag |
| `pnpm test:e2e --grep "reserva pendente" --project=firefox` | Um cenário num navegador |
| `pnpm test:e2e:ui` | Modo UI: lista, roda, inspeciona passo a passo |
| `pnpm test:e2e --headed --debug e2e/specs/finance` | Navegador visível com o Inspector parado em cada passo |
| `pnpm typecheck:e2e` | Confere os tipos da suíte (o Playwright transpila sem checar) |
| `pnpm check:e2e-selectors` | Reprova seletores frágeis (XPath, classe CSS, `.nth()`, `waitForTimeout`) |

`pnpm test:e2e:focus` roda a regressão de retorno à janela nos três portais em Chromium, com respostas de API sintéticas e sem banco. A configuração sobe Vite nas portas 52961 a 52963 e grava as evidências em `.local/focus-results`. Os cenários conferem a preservação da página e dos rascunhos durante a verificação em segundo plano, além de mudanças confirmadas de funcionalidades e recuperação após erro.

Para executar um portal por vez com menor carga, defina `E2E_FOCUS_PANEL` como `admin`, `building` ou `resident`. A seleção inicia somente o projeto e o servidor daquele portal, mantendo sua porta original (52961, 52962 ou 52963, respectivamente) e grava em `.local/focus-results-admin`, `.local/focus-results-building` ou `.local/focus-results-resident`. Um valor inválido, inclusive vazio, interrompe a configuração antes de iniciar servidores. Sem a variável, continuam os três projetos e servidores e a pasta original. Apenas `--project` não reduz os servidores globais.

```powershell
$env:E2E_FOCUS_PANEL = 'admin'
try { pnpm.cmd test:e2e:focus } finally { Remove-Item Env:E2E_FOCUS_PANEL }
```

Repita separadamente com `building` e `resident`, conferindo o resultado antes de continuar. Cada execução mantém os cenários, as esperas, a captura de falhas e o worker originais; execute as três para cobrir todos os portais. Essa regressão dirigida não substitui a suíte com API e banco reais.

A configuração sobe a API na porta 3100 e os portais nas 5273 a 5275, sempre do zero (`reuseExistingServer: false`). Se uma delas já estiver em uso (o Playwright avisa `is already used`), `$env:E2E_PORT_OFFSET=200` desloca as quatro portas e as pastas de resultado para rodar ao lado de outro projeto ou de outra execução; duas execuções simultâneas precisam de bancos separados. O serviço de ingestão não é necessário: as telas sem leitura mostram ausência de dados, nunca valores inventados.

**Tags:** `@smoke` (abre todas as páginas), `@critical` (regras centrais do negócio), `@permissions` (o servidor nega o que a tela esconde), `@validation` (campos e limites), `@agent-seed` (ponto de partida dos agentes), `@ai-generated` (gerado por IA, aguardando revisão).

## 3. Relatórios e evidências de falha

Cada teste que falha deixa, em `.local/playwright-results/<teste>/`:

- `trace.zip`: linha do tempo com DOM, rede, console e cada ação. Abra com `pnpm exec playwright show-trace <caminho>/trace.zip`.
- `video.webm`: gravação da execução.
- `test-failed-1.png`: tela no momento da falha.

O relatório HTML fica em `.local/playwright-report`. Abra com `pnpm test:e2e:report`: ele tem os passos, os erros, os anexos acima e, no `@smoke`, uma captura de cada página aberta. Tudo em `.local/` é ignorado pelo Git, porque pode conter sessões das contas sintéticas.

No GitHub Actions, cada navegador publica o artefato `playwright-evidence-<navegador>` (relatório + falhas, guardado por 3 dias). Para baixar: `gh run download <id-do-run> -n playwright-evidence-chromium`.

## 4. Gravar um fluxo com o Codegen

O login usa refresh token rotativo, e reutilizar um token revoga a família inteira de sessões. Por isso um `--load-storage` salvo funcionaria uma vez só. O gravador faz um login novo a cada vez, com uma conta-alias isolada do seed, e então abre o Inspector.

```powershell
pnpm e2e:db up
pnpm e2e:record                      # síndico no portal do condomínio
pnpm e2e:record morador           # morador no portal do morador (tela de 390 px)
pnpm e2e:record admin             # plataforma no portal da administração
pnpm e2e:record anonimo resident  # sem login: entrada, convite, recuperação de senha
pnpm e2e:record sindico resident  # qualquer perfil em qualquer portal
```

1. Espere o build dos portais (cerca de 1 minuto). Abrem o Chromium e a janela **Playwright Inspector**.
2. No Inspector, clique em **Record** e use o portal normalmente. Cada clique e digitação vira código, já com `getByRole`/`getByLabel`.
3. Para gravar uma verificação, use os botões de asserção do Inspector (visível, texto, valor) e clique no elemento.
4. Copie o código gerado e cole em `e2e/recorded/<fluxo>.ts`. Feche o Inspector: a conta-alias é apagada.

O que você fizer durante a gravação fica só no banco descartável. O código bruto **não roda** na suíte (`e2e/recorded` está fora de `testDir`). Para virar teste, revise:

- [ ] Troque os dados do seed por dados próprios do cenário (`isolatedTenant`, nomes com `suffix`), para o teste não depender da ordem nem de outros testes.
- [ ] Importe `test`/`expect` de `e2e/support/fixtures` e use `signIn` em vez dos passos de login gravados.
- [ ] Acrescente `exact: true` nos seletores de texto e remova seletores por posição ou CSS.
- [ ] Depois de cada ação que grava algo, confira a resposta real (`page.waitForResponse` + status) e o resultado visível.
- [ ] Cubra também o erro, a permissão e a validação da mesma funcionalidade (veja a seção 6).
- [ ] Coloque em `e2e/specs/<área>/`, rode nos três navegadores e apague o arquivo bruto.

Para gravar fora do gravador (com os servidores já de pé), também funciona `pnpm exec playwright codegen --target=playwright-test http://127.0.0.1:5274`.

O fluxo público **Conheça a plataforma → Explorar recursos → Login → Voltar ao início** foi gravado com o Codegen e revisado em `specs/public/platform-presentation.spec.ts`. Para reproduzir a gravação sem sessão, use `pnpm e2e:record anonimo resident`. Os testes dessa área verificam entrada mobile, formulário desktop, apresentação, retorno ao login, ausência de rolagem horizontal e problemas sérios/críticos de acessibilidade WCAG A/AA com axe nos três portais.

A área pública tem 16 cenários. Os títulos e recursos esperados diferem por público, para impedir que a página de gestão reapareça no portal do morador. O percurso do morador foi regravado no Codegen após essa separação, incluindo o acesso a **Recebi um convite**; a suíte verifica a abertura do formulário real de convite.

```powershell
pnpm test:e2e e2e/specs/public --project=chromium
```

## 5. Testes com auxílio de IA

Os agentes do Playwright para o Claude Code estão em `.claude/agents/playwright-test-{planner,generator,healer}.md`. Eles usam o servidor MCP `playwright-test` de `.mcp.json`, que o Claude Code pede para aprovar na primeira vez.

- **planner**: navega a partir de `e2e/specs/agents/seed.spec.ts` (síndico logado) e escreve um plano em `e2e/plans/<funcionalidade>.md`. Exemplo: *"use o playwright-test-planner para planejar os testes de Energia e fases, com sucesso, erro, permissão e validação"*.
- **generator**: transforma cada cenário do plano em teste, executando os passos no navegador de verdade.
- **healer**: roda um teste que falhou, investiga o trace e corrige seletores ou esperas. Ele não pode mudar regra de negócio: se a tela contradiz a regra, o defeito é relatado.

O fim de cada arquivo de agente tem as regras deste repositório (banco descartável, fixtures, seletores, tags). Rodar `playwright init-agents` de novo sobrescreve esses arquivos: reaplique as regras depois.

Os testes gerados a partir das regras do código seguem o mesmo padrão: cada um diz, no comentário do topo, de qual arquivo veio a regra (ex.: `e2e/specs/platform/features.spec.ts`).

## 6. Como escrever um teste

- **Um cenário cria os próprios dados.** `isolatedTenant(request)` cria condomínio, síndico e morador pela API autenticada, com nomes únicos. A fixture automática de `e2e/support/fixtures.ts` troca as contas do seed por aliases exclusivos do cenário e os apaga no fim.
- **Seletores estáveis**, nesta ordem: `getByRole` (com `name` e `exact: true`), `getByLabel`, `getByText`. `data-testid` só onde não houver papel ou rótulo acessível (`testIdAttribute: "data-testid"`). Nunca classe CSS, XPath, `.nth()` ou `waitForTimeout`. Exceções existentes têm o comentário `e2e-selector-allow: <motivo>`.
- **Quatro verificações por funcionalidade:** sucesso (persistiu na API e aparece), erro (falha real ou conflito 409 sem perder o rascunho), permissão (o controle some **e** a API responde 403) e validação (o botão bloqueia e a API responde 400).
- **SQL direto só para preparar o que a API não oferece** (leituras de sensor, papéis com escopo exato), via `withFixtureDatabase`, e removendo exatamente o que criou.
- **Nunca altere regra de negócio para o teste passar.** Mudanças nos apps se limitam a acessibilidade (`aria-*`, rótulos) quando faltar um seletor estável.

## 7. Organização

```
playwright.config.ts          suíte (3 navegadores, servidores, evidências)
playwright.record.config.ts   gravador (Chromium visível, sem limite de tempo)
e2e/
  support/      environment, fixtures, helpers, database (+ guarda), routes, page-health
  specs/
    smoke/            todas as páginas de cada portal
    auth/             login, cookie, sessões, MFA, troca e recuperação de senha, convites
    tenancy/          isolamento entre condomínios, unidades e equipes
    platform/         clientes, funcionalidades, auditoria, acesso de suporte
    navigation/       menu móvel e foco
    public/           entrada, apresentação comercial, Codegen e acessibilidade
    community/        avisos, chamados, reservas
    finance/          transparência e prestação de contas
    monitoring/       água, sensores, regras de alerta, consumo
    maintenance/      ordens de serviço, ativos, automações
    permissions/      ações com concessão exata por recurso
    physical-access/  portões e vagas (desligados por padrão no produto)
    agents/           seed dos agentes de IA
  recorder/     sessão logada do gravador
  recorded/     código bruto do Codegen, fora da suíte até ser revisado
  plans/        planos de teste em Markdown
scripts/e2e-db.mjs, e2e-record.mjs, check-e2e-selectors.mjs
```

Ao criar uma rota num portal, acrescente-a em `e2e/support/routes.ts`: o `@smoke` passa a abri-la.

## 8. Segurança do ambiente

- `e2e/support/database-target.ts` recusa qualquer banco que não esteja em loopback. A única exceção é o serviço `postgres` do job do GitHub, com `GITHUB_ACTIONS=true` e `E2E_DATABASE_SERVICE=postgres`. O teste dessa guarda roda no CI.
- A API lê o `.env` da raiz. A configuração força `RESEND_API_KEY` vazio, para que convites e recuperação de senha nunca enviem e-mail de verdade, e passa as URLs de banco explicitamente.
- As contas são as do seed (`admin@`, `sindico@`, `morador@predioon.local`), com a senha de demonstração `SEED_PASSWORD` (padrão `predioon123`). Não use credenciais reais.
- `specs/platform/organizations.spec.ts` altera temporariamente permissões de `PLATFORM_ADMIN` no banco descartável e as restaura no `finally`: não compartilhe o banco com outra execução ao mesmo tempo.

## 9. CI

`.github/workflows/browser.yml` roda em push na `main`, em pull requests e manualmente. São três jobs em paralelo (um por navegador), cada um com o próprio Postgres de serviço, na imagem oficial `mcr.microsoft.com/playwright:v1.63.0-noble`. Antes dos testes, o CI confere a guarda do banco, os seletores e a versão do Playwright. Os testes rodam com um worker e zero retries: uma falha intermitente aparece como falha, não como sucesso disfarçado.
