# Prédio ON — funcionalidades implementadas

Revisão de 18/10/2026, sobre o código até a migration 058 (`infrastructure/058-platform-service-health.sql`). Esta matriz descreve o que existe no código e separa implementação de validação com hardware físico. **Disjuntor/extintor continua fora do escopo.** As 23 funcionalidades que a administração liga e desliga por condomínio estão em [Controle de funcionalidades](FUNCIONALIDADES.md).

**O que mudou desde a versão de 22–23/09:**

- Entraram módulos novos: ordens de serviço, ativos, automações, convites de moradores, verificação em duas etapas, recuperação de senha por e-mail, sessões pessoais, histórico de auditoria por escopo, clientes, edição e desativação de blocos/unidades/equipes, entrega durável de alertas, acesso temporário de suporte da plataforma (053), os apps Morador e Operação e a liberação de consumo para moradores.
- Os apps ganharam a aba Consumo e o aceite de convite no Morador, a abertura e atribuição de ordens de serviço no Operação e **Esqueci minha senha** nos dois.
- **Portões e vagas vêm desligados por padrão**, inclusive em instalações que já existiam (049 e 050). Só devem ser ligados quando o condomínio tiver o equipamento instalado e testado.
- **O morador não vê mais o nível da caixa d'água**: nem no portal nem pela API (051).
- A ingestão deixou de usar a conexão dona do banco e roda com duas roles restritas (052). Contas e vínculos passaram a ser decididos pelas capacidades vigentes, não pelo papel legado (054).
- Ações que dão poder a alguém pedem a senha de novo se ela não foi provada na sessão nos últimos 10 minutos (055). As últimas leituras usam um catálogo de séries (056), as automações também abrem ordens em datas programadas (057) e a administração vê a saúde dos serviços (058).
- O papel `BUILDING_ADMIN` aparece como **Síndico** em todas as telas. É um papel só; antes duas telas o chamavam de "Administrador do condomínio".

## Portais e aplicativos

| Superfície | Para quem | O que oferece hoje |
|---|---|---|
| Portal de administração | Administração da plataforma | Visão geral com Serviços da plataforma, Condomínios, Clientes, Operação dos imóveis, Comunicação (gateways), Equipamentos, Suporte remoto, Usuários, Unidades e equipes, Acesso de suporte, Funcionalidades, Histórico de atividades, Minhas sessões |
| Portal de operação | Síndico e equipe do condomínio | Monitoramento (água, energia, consumo, sensores, equipamentos), alertas, ocorrências, ordens de serviço, ativos, avisos, áreas comuns, transparência e contas, unidades e equipes, regras de alerta, automações, histórico, Acesso de suporte (só leitura), Minhas sessões. Portões e vagas só aparecem quando ligados |
| Portal do morador | Morador | Início, reservas, ocorrências, avisos, transparência, perfil com Minhas sessões. Acessos e Vagas só quando ligados; Consumo só quando o síndico libera |
| App Morador (React Native) | Morador | Avisos, Solicitações, Reservas, Transparência e Minha conta; **Tenho um convite** na entrada. Consumo só quando o síndico libera; Acessos só quando ligado |
| App Operação (React Native) | Equipe do condomínio | Resumo, Alertas, Sensores, Solicitações, Ordens de serviço e Minha conta, conforme as permissões de cada pessoa |

Os dois apps compartilham o código de `packages/mobile`, têm **Esqueci minha senha** na entrada e consultam o estado das funcionalidades do condomínio escolhido. Requisitos, execução e limites em [Aplicativos móveis](../packages/mobile/README.md).

## Monitoramento e alertas

| Recurso | Implementação | Referência |
|---|---|---|
| Volume na caixa d'água | Nível, volume em litros e distância quando enviados pelo equipamento; histórico e limites. Visível para a equipe do condomínio; o morador não recebe o nível (051). | [Sensores](SENSORES.md), tela Água |
| Falta de fase e parâmetros | Tensão nas três fases, corrente/frequência quando medidas e regras configuráveis; seed com subtensão/sobretensão por fase. | [Sensores](SENSORES.md), tela Energia |
| Vazamento de água e esgoto | Métricas e pontos distintos, sinais booleanos, regras e painel de sensores. Compatibilidade com `leak_detected` antigo. | [Sensores](SENSORES.md) |
| Fumaça e temperatura | Sinal do relé de alarme da central, temperatura e limites; contrato, cadastro, tela e simulação. | [Sensores](SENSORES.md) |
| Gás | Sinal de detecção e ppm quando enviados pelo equipamento, cadastro, painel, regra e cenário de simulação. | [Sensores](SENSORES.md) |
| Relé da bomba | Estado, tempo contínuo e total diário; alertas por limite ou histórico. | [Consumo e análise](CONSUMO_E_ANALISE.md) |
| Análise de desvios | Modelo estatístico que aprende referência e variação com histórico válido de energia, água e bomba; estado de aprendizado e explicação. Sensores críticos mantêm regras explícitas. | [Consumo e análise](CONSUMO_E_ANALISE.md) |
| Consumo para moradores (051) | Liberação por condomínio, decidida pelo síndico em Consumo e análise e **desligada por padrão**. Liberado, o morador vê, no portal e na aba Consumo do app, só a quantidade diária de energia e de água dos últimos 7 dias; nunca tarifa, custo, limite, bomba ou equipamento. A decisão é auditada. | [Controle de funcionalidades](FUNCIONALIDADES.md#consumo-para-moradores-liberação-do-síndico) |
| Entrega durável de alertas (038) | Alerta e evento gravados na mesma transação; um serviço separado (`@predioon/notifications`) envia por webhook os alertas HIGH/CRITICAL, com reserva, tentativas e confirmação. Desligar uma funcionalidade cancela as entregas que deixaram de valer. | [Notificações duráveis](NOTIFICACOES_DURAVEIS.md) |
| Recibo de leituras (048) | Leitura identificada por condomínio, dispositivo e evento; reentrega aplicada uma vez; leitura retida pelo broker vira só histórico; alerta só para leitura com até 300 s. Recusas contadas por categoria, sem conteúdo. | [Decisões da inbox](INBOX_DECISOES.md) |
| Ingestão com roles restritas (052) | Leituras, recibos, consumo, vagas, alertas e outbox passam pela role `predioon_ingest`; comandos de portão e confirmações, pela `predioon_access_service`, só por funções privadas. O serviço confere as duas identidades antes de conectar ao MQTT e recusa iniciar com a conexão dona (`DATABASE_URL`). | [Migrações](MIGRATIONS.md), [Implantação](DEPLOY.md) |
| Catálogo de séries e retenção (056) | Uma linha por série (condomínio, dispositivo, métrica) mantida por gatilho; as últimas leituras do painel passaram de 1,3 s para 0,27 s na medição com 50 dispositivos. A retenção das leituras é opcional e manual (`pnpm db:telemetry-retention`, mínimo de 13 meses); nada apaga leituras sozinho. Compressão e agregados contínuos não estão disponíveis com RLS. | [Modelo de dados](DATABASE_MODEL.md), [Migrações](MIGRATIONS.md) |
| Saúde dos serviços (058) | Cartão **Serviços da plataforma** na visão geral da administração: última leitura e leituras da última hora, gateways online, fila e falhas de entrega de alertas, comandos de portão sem resposta, tarefas agendadas e tamanho do banco. Só contagens e instantes. Healthcheck nos serviços do Compose de produção. | [Migrações](MIGRATIONS.md), [Implantação](DEPLOY.md) |
| Aplicação em diferentes imóveis | Cadastro de condomínio, casa ou imóvel comercial e fuso IANA, associado a um cliente. | Condomínios, no portal de administração |

## Acessos e vagas (desligados por padrão)

As quatro funcionalidades (portão da garagem, portão de pedestres, vagas de carros, vagas de motos) começam desligadas no nível global. Desligadas, as telas somem dos portais e do app Morador, a API recusa as rotas e a ingestão descarta as leituras desses módulos. Os cadastros ficam guardados para quando forem ligadas em **Administração → Funcionalidades**.

| Recurso | Implementação quando ligado | Referência |
|---|---|---|
| Portão garagem/pedestre | Cadastro, permissões, pedido de abertura, expiração, idempotência, MQTT, confirmação do controlador e auditoria. Desligar cancela e audita os pedidos ainda pendentes. | [Acessos](ACESSOS.md) |
| Vagas de carro/moto | Contadores separados, capacidade, ocupação e disponibilidade; atualização manual ou sensor, origem/horário e indicação de dado antigo ou desconhecido. Ao religar, a ocupação volta como desconhecida. | [Vagas e avisos](VAGAS_AVISOS.md) |

## Avisos e rotina

| Recurso | Implementação |
|---|---|
| Dia da coleta de lixo | Atalho de categoria, data, publicação programada e repetição semanal. |
| Reunião | Aviso com data e hora de ocorrência e período de publicação. |
| Limpeza do hall | Atalho de categoria, data e repetição semanal opcional. |
| Agendamento do salão | Módulo de reservas, aprovação, cancelamento e conflito de horários, nos portais e no app Morador. |
| Caixa de serviços a fazer | Módulo de chamados, protocolo, prioridade e situação. Para o trabalho da manutenção, ver ordens de serviço abaixo. |

Detalhes em [Vagas e avisos](VAGAS_AVISOS.md). A agenda calcula a próxima ocorrência e controla a publicação; lembretes por WhatsApp/e-mail não são enviados por esse módulo.

## Manutenção

| Recurso | Implementação | Referência |
|---|---|---|
| Ordens de serviço (043) | A gestão abre, atribui a uma pessoa ou equipe, edita e cancela; quem executa inicia, pausa, conclui e anota. Histórico por ordem e recusa de lista desatualizada. No app Operação, a gestão também abre (título, detalhes, prioridade e responsável) e atribui, e quem executa inicia, pausa, conclui e anota; prazo, ativo e cancelamento ficam no portal. Morador não tem acesso. | [Ordens de serviço](ORDENS_DE_SERVICO.md) |
| Ativos (044) | Cadastro dos bens físicos (bomba, elevador, gerador, portão), vínculo com os equipamentos monitorados e com as ordens de serviço, formando o histórico do ativo. O nome do ativo aparece na ordem, no portal e no app. | [Ativos](ATIVOS.md) |
| Automações (045, 057) | Regra versionada que abre uma ordem de serviço com título, prioridade, equipe e ativo definidos, por um de dois gatilhos: um alerta que corresponde à versão publicada e ativa, ou datas programadas (a cada N dias a partir de uma data, às 8h, uma ordem por data). As programadas rodam no agendador do TimescaleDB a cada 5 minutos, sem processo novo. Rascunho, publicação, ativação e simulação. **Nunca aciona equipamento**: não existe ação de comando. | [Automações](AUTOMACOES.md) |

## Atendimento, transparência e contas

| Recurso | Implementação | Referência |
|---|---|---|
| Suporte remoto | Cadastro do AnyDesk por condomínio, solicitação auditada, abertura no cliente instalado e resultado manual | [Suporte remoto](SUPORTE_REMOTO.md) |
| Acesso temporário de suporte (053) | A administração mantém a equipe de suporte da plataforma e concede a uma pessoa dela, com motivo e prazo de até 7 dias, a leitura de sensores, alertas, equipamentos, ordens atribuídas ou concessões de um condomínio. Revogação imediata; concessões não são editadas nem apagadas. O síndico acompanha em Administração → Acesso de suporte, só leitura. É separado do Suporte remoto (AnyDesk) e não depende da central de funcionalidades. | [Migrações](MIGRATIONS.md), [Controle de funcionalidades](FUNCIONALIDADES.md#catálogo) |
| Chamados de morador e síndico | Abertura pelos dois portais e pelo app Morador, acompanhamento também no app Operação, três gravidades, comentários e histórico | [Gestão transparente](GESTAO_TRANSPARENTE.md) |
| Gravidade alterada pelo síndico | Baixa, média e alta, justificativa obrigatória e histórico ao solicitante | [Gestão transparente](GESTAO_TRANSPARENTE.md) |
| Três chamados iguais | Sugestão por categoria, assunto normalizado e local; confirmação da gestão, resposta e conclusão do grupo | [Gestão transparente](GESTAO_TRANSPARENTE.md) |
| Transparência | Atualizações públicas de decisões, andamento, prazos e serviços, preservando relatos particulares | [Gestão transparente](GESTAO_TRANSPARENTE.md) |
| Prestação de contas | Relatórios mensais em centavos, receitas/despesas, saldo, links de comprovantes, rascunhos privados e publicação com revisões imutáveis | [Gestão transparente](GESTAO_TRANSPARENTE.md) |

## Contas, permissões e cadastros

| Recurso | Implementação | Referência |
|---|---|---|
| Entrada e sessões pessoais | Uma sessão por entrada; **Minhas sessões** nos três portais lista as sessões da conta e encerra uma ou todas. Revogar vale na requisição seguinte. Limite persistente de tentativas por conta e por rede. | [Autenticação](AUTENTICACAO.md) |
| Troca da própria senha | Nos três portais e em Minha conta nos apps; encerra todas as sessões da conta, inclusive a atual. | [Troca de senha](TROCA_DE_SENHA.md) |
| Verificação em duas etapas (046) | Código TOTP de aplicativo autenticador e códigos de recuperação de uso único. Ativação em Minhas sessões, nos portais; campo de código na entrada dos três portais e dos dois apps. | [Autenticação](AUTENTICACAO.md#verificação-em-duas-etapas-mfa) |
| Recuperação de senha por e-mail (047) | **Esqueci minha senha** nos três portais e nos dois apps, envio pelo Resend. Resposta igual para conta inexistente; link de uso único com prazo; a troca encerra as sessões. Nos apps, a pessoa pede o link e cria a nova senha no portal. Sem `RESEND_API_KEY` as rotas respondem igual e nenhum e-mail sai. | [Autenticação](AUTENTICACAO.md#recuperação-de-senha-por-e-mail) |
| Convites de moradores (042) | O gestor emite, lista e revoga; o morador aceita em **Tenho um convite**, no portal, e a conta nova recebe só o papel Morador e a unidade. **Tenho um convite** existe também no app Morador. Também por e-mail quando o Resend está configurado. | [Autenticação](AUTENTICACAO.md#convites-de-moradores) |
| Confirmação recente (055) | Criar conta, tornar alguém síndico, conceder papel, incluir na equipe de suporte, conceder acesso de suporte e emitir a credencial MQTT de um gateway exigem senha (e código, se a conta usa MFA) provada nesta sessão nos últimos 10 minutos. Nos portais, a janela **Confirme que é você** pede a prova e repete o pedido uma vez. Renovar o token não renova a prova; reduzir acesso não pede confirmação. | [Autenticação](AUTENTICACAO.md#confirmação-recente-para-ações-privilegiadas-055) |
| Papéis e concessões | Concessões por pessoa ou equipe, com vigência, conferidas no banco a cada requisição. Papéis do condomínio: Síndico, Gestor de manutenção, Manutenção e Morador. | [Autorização](AUTORIZACAO.md) |
| Contas e vínculos (054) | Listar pessoas, criar contas e vincular pessoas ao condomínio dependem das capacidades vigentes, não do papel legado. Um síndico só por papel lista e vincula pessoas do próprio condomínio; ninguém concede um papel com capacidades que não tem; vínculo é revogado, não apagado. Só o Suporte remoto ainda confere o papel legado. | [Migrações](MIGRATIONS.md) |
| Blocos, unidades e equipes (041) | Criar, editar, desativar e reativar, com auditoria. Inativo suspende o acesso derivado até a reativação; não há exclusão. | [Autorização](AUTORIZACAO.md) |
| Clientes (039) | Cadastro comercial das organizações na administração; cada condomínio pertence a um cliente. O cliente não concede acesso operacional aos condomínios. | [Migrações](MIGRATIONS.md) |
| Histórico de atividades | Auditoria por escopo: plataforma, condomínio inteiro ou recurso exato, paginada, só com permissão vigente de leitura. | [Auditoria](AUDITORIA.md) |

## Exemplos de monitoramento

- **R$ 10 → R$ 50/dia:** consumo medido vezes tarifa configurada produz custo estimado; referência de 10 para observado de 50 significa aumento de 400%.
- **Água fora do padrão:** consumo do hidrômetro é comparado com limite e histórico, separado dos sensores locais de vazamento.
- **Bomba 60 → 120 minutos/dia:** o sistema soma intervalos válidos e compara total e duração contínua com os parâmetros.
- **Carros e motos:** dados desconhecidos ou antigos não são mostrados como zero vagas livres.

Um desvio indica necessidade de investigação. O sistema não localiza sozinho uma luminária com fuga nem comprova a causa de um consumo alto.

## Verificações mais recentes

Resumo de 07/10 a 18/10 a partir de [Continuidade](CONTINUIDADE.md) e do [histórico até 17/10](continuidade/historico-ate-2026-10-17.md), onde estão os detalhes, as falhas encontradas no caminho e as correções. São execuções locais, com API e ingestão em Linux e banco novo. Desde 17/10 elas rodam no job `platform` reproduzido num contêiner Linux com memória limitada, porque em 16/10 o computador reiniciou durante uma regressão completa no Windows.

| Data | Mudança | Resultado registrado |
|---|---|---|
| 07/10 | Esqueci minha senha nos dois apps (publicado em `7289e18`) | Mobile 127/127, cliente 75/75, quatro bundles JS de release; sem emulador ou aparelho |
| 08/10 | Teste visual dos três portais e correção dos achados | Percurso visual 69/69 (a primeira execução deu 66/69); matriz de navegadores 339/339 |
| 08/10 | Portões e vagas desligados por padrão (049) | Ingestão 129/129; matriz 339/339; API 791/792, com a falha corrigida e o arquivo repetido 5/5, sem repetir a suíte completa |
| 08/10 | Desligados também em instalações existentes (050) | Teste da migration 3/3; API 792/792; ingestão 129/129; matriz 339/339; app Morador no emulador Android sem a aba Acessos |
| 08/10 | Nível da caixa d'água fora do portal do morador | Nove arquivos de navegador do portal do morador, 129/129 |
| 09/10 | Consumo só com liberação do síndico (051) | API 797/797 (a primeira deu 787/797: nove falhas de convite, corrigidas antes de publicar, e uma de recuperação de senha que passou ao repetir); ingestão 129/129; **matriz 342/342**; notificações 54/54; restauração 2/2 com 51 migrations |
| 09/10 | Síndico como nome único do papel | Tipos e UI 93/93; matriz não repetida para a troca de texto |
| 12/10 | Relógio do banco nas vagas, sobre a 051 | API 804/804; ingestão 129/129 |
| 12/10 | Aba Consumo no app Morador (`7ff57a4`) | Mobile 157/157, cliente 75/75, UI 93/93, quatro bundles JS; sem emulador ou aparelho |
| 13/10 | Abrir e atribuir ordens no app Operação (`f83e3c6`) | Mobile 219/219, cliente 75/75, UI 93/93, quatro bundles JS; sem emulador ou aparelho |
| 17/10 | Ingestão com roles restritas (052) | SQL052 73/73; suítes da ingestão com as duas roles 112/112; job platform: API 804/804, ingestão 196/196, banco 297/299 (2 skips de backup); restauração 2/2; MQTT com banco real e queda do receptor 2/2 |
| 17/10 | Acesso temporário de suporte (053) | API do módulo 3/3; Chromium 1/1 no cenário novo e 30/30 nos vizinhos; job platform: API 806/807 (a falha foi um 429 do limitador num teste de recuperação de senha, que passou 8/8 isolado), ingestão 199/199, UI 98/98, mobile 219/219 |
| 17/10 | Contas e vínculos por capacidade (054) | Teste novo 5/5; dirigidos 109/109; job platform: **API 812/812**, **ingestão 199/199**, banco 298/300 (2 skips de backup), UI 98/98, mobile 219/219, cliente 115/115; SQL052 73/73; restauração 2/2; Chromium 50/50 |
| 17/10 | 055 a 058 e convite no app Morador (última rodada, clusters novos) | **API 827/827**, **ingestão 204/204**, banco 301/303 (2 skips de backup, cobertos pelo teste próprio), cliente 118/118, UI 108/108, mobile 224/224; SQL052 73/73; serviços restritos 114/114; restauração 2/2 três vezes; ingestão real com broker 12/12; **Chromium completo 117/117** |
| 18/10 | Datas ISO nas rotas lidas pelos apps, `demo:data` e vídeos | API 828/829 (um teste intermitente conhecido de recuperação de senha, que passou 3/3 isolado); ingestão 204/204; teste novo de datas 2/2; os dois apps percorridos no emulador Android para os [vídeos](videos/README.md) |

**Não verificado:**

- **Hardware físico:** nenhum sensor, controlador ou portão real foi acionado. As leituras vieram do simulador e de dados fictícios gerados pela ingestão.
- **Firefox e WebKit depois de 09/10:** a última matriz em três navegadores é a de 342/342. Desde então só o Chromium rodou (117/117 completo em 17/10): o Firefox não está instalado e o WebKit é bloqueado pelo AppControl desta máquina.
- **CI do GitHub:** todo push desde o início de outubro termina em `startup_failure` antes de criar jobs, o que aponta para bloqueio da conta (cobrança ou minutos). Só o proprietário resolve.
- **Apps no Android:** em 18/10 os dois foram percorridos no emulador para os vídeos (Morador: entrada com Tenho um convite, avisos, solicitações, reservas, transparência e acessos; Operação: resumo, alertas, sensores e ordens de serviço), sem avisos Fabric no logcat. A aba Consumo não aparece, porque a conta de demonstração não tem liberação; a recuperação de senha e a abertura/atribuição de ordens nos apps não estão descritas nesse percurso e seguem verificadas por testes e bundles JS. Nenhum aparelho físico.
- **Instalação de demonstração do proprietário:** as migrations 050 a 058 não foram aplicadas nem observadas nela.
- **Teste intermitente conhecido:** `password-recovery.test.ts` → "keeps two-step verification in place after a reset" falhou uma vez na integral de 18/10 e passou 3/3 isolado; a causa não foi demonstrada.
- Também pendentes: entrega real de e-mail pelo Resend, verificação em duas etapas com aplicativo autenticador num celular, apps iOS autenticados, aparelhos físicos, MQTT de campo, ensaio de carga com a ingestão real e implantação em produção.

O registro detalhado das verificações de 22–23/09 (144 testes, ensaios com broker local e conferências no navegador) continua no histórico do git: `git show 6ee13e4:docs/REVISAO_FUNCIONALIDADES.md`.

## Repetir a validação local

Use sempre um banco descartável: o seed redefine as senhas de demonstração, e as suítes alteram dados e roles. Nunca rode seed ou reset numa instalação em uso. Outras sessões podem estar usando portas de teste nesta máquina; confira que a porta está livre e que o contêiner subiu antes de apontar qualquer teste para ela. Com pouca memória livre, prefira rodar a regressão completa num contêiner Linux com limite de memória.

1. Suba o banco descartável e defina as sete URLs (a dona e as seis roles restritas) conforme [Migrações → Testes em banco isolado](MIGRATIONS.md#testes-em-banco-isolado).
2. No PowerShell, na raiz do projeto, execute cada etapa só depois que a anterior terminar sem erro:

```powershell
pnpm install --frozen-lockfile
pnpm db:wait
pnpm db:bootstrap
pnpm db:infra
pnpm db:infra --check
pnpm db:provision-runtime
$env:SEED_PHYSICAL_FEATURES = 'enabled'
pnpm db:seed
$env:TEST_MIGRATIONS_DATABASE_URL = $env:DATABASE_URL
$env:RUN_ACCESS_DB_TESTS = '1'
$env:RUN_RBAC_DB_TESTS = '1'
pnpm --filter @predioon/db exec node --import tsx --test --test-concurrency=1 test/*.test.ts
$env:TEST_INGEST_DISPOSABLE_DB = '1'
$env:TEST_INGEST_DATABASE_URL = $env:DATABASE_URL
$env:TEST_INGEST_RUNTIME_DATABASE_URL = $env:DATABASE_URL_INGEST
$env:TEST_ACCESS_RUNTIME_DATABASE_URL = $env:DATABASE_URL_ACCESS_SERVICE
pnpm typecheck
pnpm check:boundaries
pnpm test
pnpm build
```

- `SEED_PHYSICAL_FEATURES=enabled` liga portões e vagas e cria seus equipamentos de demonstração, porque as suítes exercitam esses módulos. É o mesmo que os workflows de CI fazem. Não use em demonstração nem em produção.
- As quatro variáveis `TEST_INGEST_*`/`TEST_ACCESS_*` fazem as suítes da ingestão autenticar com as duas roles restritas; a URL dona serve só à preparação dos dados. Sem elas, `pnpm test` falha de propósito, em vez de cair na conexão dona.
- `pnpm test` roda, em série, cliente, UI, mobile, API e ingestão. Não inclui o pacote do banco (por isso o comando anterior), as suítes SQL038/worker, as suítes SQL052 nem a restauração de backup. Essas trocam senhas de roles do cluster inteiro e precisam de clusters próprios, como nos jobs `notifications`, `ingest-runtime` e `backup` de `.github/workflows/ci.yml`.
- Matriz de navegadores: encerre `pnpm dev`, rode `pnpm exec playwright install chromium firefox webkit` e depois `pnpm test:e2e`, respeitando as restrições de `e2e/database-target.ts`. Neste Windows o WebKit foi bloqueado pelo AppControl: use um runner Linux ou a imagem oficial `mcr.microsoft.com/playwright:v1.63.0-noble`, sem desativar a proteção do sistema.

Para uma demonstração local, e não para testes: com o `.env` copiado de `.env.example`, `pnpm setup:local` e depois `pnpm dev`. O `setup:local` já gera `services/ingest/.env.runtime` (`pnpm ingest:env`), sem o qual a ingestão não inicia. Sem a variável acima, portões e vagas ficam desligados, como numa instalação real. Para leituras ao vivo, use o simulador conforme [Sensores](SENSORES.md); o simulador de portões está em [Acessos](ACESSOS.md). `pnpm --filter @predioon/ingest demo:data` gera leituras fictícias pelo pipeline real (só em banco de demonstração); foi usado em 18/10 para os vídeos, depois da correção que o faz terminar ao fechar o pool restrito da ingestão.

## Condições de operação

Sensores e controladores precisam seguir os contratos documentados e ser configurados e testados no imóvel. Um ACK confirma a execução informada pelo controlador, sem medir a posição atual do portão. Portões e vagas começam desligados, e os portões criados pelo seed de teste também nascem desativados no cadastro. Em produção, a ingestão recebe só as duas URLs restritas, nunca a conexão dona. Alertas HIGH/CRITICAL podem ser encaminhados por webhook; WhatsApp exige integração externa, e o e-mail pelo Resend cobre só recuperação de senha e convites, não alertas. Notificação push não será implementada, por decisão do proprietário. Fumaça e gás não substituem sistemas certificados.

Materiais comerciais: [apresentação comercial](marketing/APRESENTACAO_COMERCIAL.md) e [exemplos de uso](marketing/CASOS_DE_USO_E_EVOLUCOES.md).
