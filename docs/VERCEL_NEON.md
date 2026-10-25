# Demonstração na Vercel e no Neon

Publicada e verificada em 25/10/2026. Este perfil publica os três portais e a API HTTP com dados fictícios. A implantação completa com broker, ingestão, notificações e agendador está em [DEPLOY.md](DEPLOY.md).

| Painel | Endereço |
| --- | --- |
| Administração | https://predioon-admin.vercel.app/login |
| Síndico | https://predioon-sindico.vercel.app/login |
| Morador | https://predioon-morador.vercel.app/login |
| API | https://predioon-api.vercel.app/health/ready |

## Projetos

Cada projeto Vercel usa a `main` de `helberjf/predioON`, com acesso aos arquivos do monorepo fora de sua raiz:

| Projeto | Raiz | Função |
| --- | --- | --- |
| predioon-api | apps/api | Express; valida as três identidades restritas do banco na primeira requisição |
| predioon-admin | apps/admin-web | Administração da plataforma |
| predioon-sindico | apps/building-web | Gestão do condomínio |
| predioon-morador | apps/resident-web | Portal próprio do morador |

Os portais compilam com `VITE_API_URL=/api` e encaminham esse caminho à API. A sessão mantém cookie `HttpOnly`, `Secure`, `SameSite=Strict`, prefixo `__Host-`, proteção por origem e header próprio. Cada origem conserva seu espaço de sessão. As rotas `/internal` do broker respondem 404 na entrada pública Vercel; o servidor do Compose mantém sua inicialização e suas rotas privadas.

A API executa `pnpm build:vercel`: o esbuild inclui os fontes dos workspaces no bundle `dist/vercel.mjs`, e `app.mjs` fornece a entrada Express. Pacotes externos, incluindo o Argon2 nativo, continuam disponíveis para o rastreador da Vercel. O bundle não incorpora valores de variáveis privadas. A compilação padrão da API usada nos outros ambientes continua disponível.

## Banco novo

Foi criado `predioon-demo-db`, projeto Neon `bold-leaf-99201114`, no plano Free, região AWS São Paulo. PostgreSQL 18.6 e TimescaleDB 2.24.0, com validação TLS habilitada. A instalação foi iniciada com zero tabelas públicas. O seed foi executado uma única vez nesse banco novo; não se deve executá-lo novamente em uma instalação com dados.

```sh
pnpm db:bootstrap
pnpm --filter @predioon/db db:infra --provider=neon-demo
pnpm --filter @predioon/db db:infra --provider=neon-demo --check
pnpm --filter @predioon/db db:provision-runtime --api-only
```

O provisionamento `--api-only` exige somente owner e as conexões `DATABASE_URL_APP`, `DATABASE_URL_IDENTITY` e `DATABASE_URL_BROKER_AUTH`. Valida os nomes fixos, servidor/banco, atributos, vínculos e ausência de objetos pertencentes ao runtime antes de habilitar LOGIN. O provisionamento padrão de seis serviços preserva todas as validações anteriores. Os três serviços permanentes não usados neste perfil permanecem NOLOGIN.

O owner não é enviado à aplicação Vercel. Chaves Ed25519, segredo de limitação de login, criptografia MFA, segredo QR e três URLs restritas ficam exclusivamente nas variáveis privadas da API. Os portais não recebem credenciais de banco.

## Perfil explícito das migrations

`--provider=neon-demo` adapta somente os fontes revisados por checksum, sem editar os arquivos SQL publicados:

- 015, 038 e 052: o Neon recusa `ALTER ROLE ... NOSUPERUSER`, mesmo para uma role comum. O adaptador verifica `rolsuper=false` antes e depois e mantém `NOINHERIT`, `NOBYPASSRLS` e as demais restrições.
- 057: a edição Apache do Timescale no Neon recusa `add_job`. As tabelas e funções da automação são instaladas, mas não se cadastra um agendador. Um comentário explícito no catálogo identifica essa limitação.

O histórico inclui o SQL original e o adaptador no checksum. Um comando sem o perfil correto recusa o histórico diferente; não reescreva checksums nem troque o perfil de uma instalação existente. A aplicação confirmou as migrations 001–059 atomicamente, e `--check` confirmou que nenhuma ficou pendente.

## Limites da demonstração

Os logins e os recursos HTTP dos painéis usam o banco real do Neon. Sensores, comandos físicos e entrega por workers dependem dos serviços da VPS. Automações programadas não executam neste perfil; para executá-las, use a implantação completa ou implemente e valide um agendador compatível. Portões e estacionamento começam desligados, conforme o padrão do produto. E-mails não são enviados sem configurar o Resend e um remetente autorizado.

O plano gratuito pode suspender o banco após inatividade; o primeiro acesso pode levar mais tempo. Não habilitar hardware real nem carregar dados reais num ambiente com usuários e senha de demonstração.

## Evidências da preparação

- Testes da entrada serverless: 3/3, cobrindo inicialização concorrente, recusa sanitizada e bloqueio de rotas internas.
- Interface compartilhada: 116/116, incluindo URL relativa e isolamento das sessões.
- Adaptador Neon e seleção de credenciais: 55/55.
- Typechecks de API, UI e banco e builds dos três portais aprovados.
- API local em modo production, conectada ao Neon somente com credenciais restritas: health 200, três logins 200, três refreshes 200, listagem de condomínios 200 e saúde dos serviços da administração 200.
- Entrada final `app.mjs` e bundle de 383 KB executados diretamente pelo Node: mesma validação aprovada, sem depender do carregador TypeScript de desenvolvimento. Isso cobre a ausência de fontes de workspace identificada no primeiro runtime da Vercel.

A verificação real com Playwright Chromium aprovou os três painéis: login 200 com a identidade esperada, cookie seguro, refresh 200 após recarga, título autenticado, logout 204, volta à entrada e apresentação mobile própria. Nenhuma exceção JavaScript ou resposta 5xx foi observada na rodada aprovada. O Morador também foi autenticado e conferido no Chrome do proprietário.

[Resultados sem tokens ou chaves](evidencias/vercel-neon-2026-10-25.json) e [captura do Morador publicado](imagens/2026-10-25/morador-vercel.jpg). Frontends: fonte `125e0360`; API: fonte `ed1017cf`. A API respondeu `{"ok":true,"database":"up"}` em HTTPS. Estes checks são da implantação; não representam uma nova execução integral das suítes de API, ingestão e aplicativos nativos.

Referências dos provedores: [Express na Vercel](https://vercel.com/docs/frameworks/backend/express) e [TimescaleDB no Neon](https://neon.com/docs/extensions/timescaledb).
