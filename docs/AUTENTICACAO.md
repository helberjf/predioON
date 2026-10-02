# Autenticação e sessões

Cada login cria uma sessão independente. O access token EdDSA contém apenas `sub` e `sid`, tem emissor e audiência `predioon-api` e dura cinco minutos por padrão. A API lê a sessão, a conta e os vínculos ativos no banco a cada requisição; revogar uma sessão, desativar uma conta ou encerrar um vínculo vale sem esperar o JWT vencer.

O refresh token é opaco e só seu SHA-256 é armazenado. Cada família tem expiração absoluta, sem extensão ao rotacionar. Uma rotação consome o token e grava o sucessor numa transação que trava a sessão. Reutilizar um token consumido revoga toda a família, inclusive o sucessor; a revogação é confirmada antes da resposta 401. Um cliente deve serializar suas renovações: se perder a resposta e reapresentar o token antigo, deverá fazer login novamente.

`GET /auth/sessions` retorna `{ "items": [...] }` com até as 100 sessões próprias mais recentes e `current`. `DELETE /auth/sessions/:id` revoga uma sessão própria; outra pessoa recebe 404. `POST /auth/sessions/revoke-all` encerra todas as sessões da conta, inclusive a atual. `POST /auth/logout` aceita qualquer refresh token conhecido da família, mesmo já consumido.

## Chaves e implantação

Em produção, configure `JWT_ACTIVE_KID`, `JWT_PRIVATE_KEY` (Ed25519 PKCS#8 PEM) e `JWT_PUBLIC_KEYS` (objeto JSON de `kid` para chave pública SPKI PEM). Valores PEM podem usar `\n` literais nas variáveis. A chave pública ativa deve corresponder à privada; outras entradas públicas verificam tokens emitidos antes da rotação até expirarem. Falta, formato inválido ou par incompatível impedem a inicialização. Não registre ou distribua a chave privada.

Em desenvolvimento, sem as três variáveis, um par efêmero é gerado na inicialização. Reiniciar o processo invalida os access tokens locais. `JWT_ACCESS_TTL_MINUTES` aceita ajuste operacional, com padrão de cinco minutos. `JWT_REFRESH_TTL_DAYS` define a expiração absoluta da família.

A migração `infrastructure/013-sessions.sql` é aditiva. Refresh tokens anteriores não têm `session_id` e falham fechados. JWTs HS256 antigos também falham fechados. A transição exige um novo login uma vez; não há janela de compatibilidade que permita contornar a revogação de sessão.

## Sessões dos portais

Os três portais usam `/auth/web/login`, `/auth/web/refresh` e `/auth/web/logout`. Login e refresh retornam somente access token e identidade. O access fica na memória da página; o refresh fica em cookie HttpOnly do host da API. Em HTTPS esse cookie é Secure, usa prefixo `__Host-`, Path=/ e não define Domain. SameSite=Strict e validade absoluta acompanham a família da sessão. O nome deriva da origem do portal: entrar ou sair de um portal não substitui a sessão dos outros.

Esses POSTs enviam JSON, `credentials: include` e `X-Predioon-Web: 1`. A API exige Origin exata presente em `CORS_ORIGINS` e rejeita requisições cross-site. As rotas de domínio continuam exigindo bearer; um cookie isolado não autentica `/auth/me`, consultas ou alterações. O SSE usa fetch com bearer no cabeçalho e sem credencial na URL.

As abas do mesmo portal serializam login, refresh e logout usando Web Locks. LocalStorage contém somente uma versão opaca da identidade e a intenção de encerrar sessão; BroadcastChannel e eventos de storage comunicam mudanças sem transportar tokens. A aba confere a versão persistida antes de usar suas credenciais, inclusive quando perdeu uma notificação enquanto estava suspensa. Navegador sem Web Locks ou sem acesso ao armazenamento apresenta uma mensagem de incompatibilidade e não inicia autenticação.

Recarregar a página restaura a sessão pelo cookie. Uma falha transitória conserva a possibilidade de recuperação e oferece nova tentativa. Logout limpa a identidade local imediatamente. Se não houver rede, a interface informa que a revogação remota não foi confirmada; a intenção de logout bloqueia restauração após reload. O próximo login precisa revogar o cookie anterior antes de autenticar outra conta. Isso evita recuperar a conta antiga quando a nova senha for recusada.

## Implantação e transição dos portais

1. Publicar a API com os endpoints web antes dos novos portais. Os endpoints JSON nativos permanecem disponíveis para os apps.
2. Usar HTTPS e um mesmo site para API e portais em produção: por exemplo `api.exemplo.com.br`, `admin.exemplo.com.br`, `sindico.exemplo.com.br` e `morador.exemplo.com.br`. O Compose/Caddy já segue esse formato. Configurar cada origem exata em `CORS_ORIGINS`, sem caminho nem barra final, e compilar os portais com `VITE_API_URL` da API correspondente.
3. Um frontend em domínio de preview de outro site, inclusive URLs históricas `*.vercel.app` com API externa, não é compatível com o cookie Strict. Configurar um domínio próprio do mesmo site no provedor antes de usar esse frontend. Acrescentar a origem ao CORS, sozinho, não altera essa restrição.
4. Em desenvolvimento, HTTP só é aceito em loopback fora de produção. Usar `localhost` em todos os endereços ou `127.0.0.1` em todos, com as portas corretas no CORS. Não combinar esses dois hostnames na mesma instalação.
5. A primeira abertura do novo cliente remove `predioon.access` e `predioon.refresh` do localStorage. Uma sessão que só existia nesses campos exige novo login; não há importação silenciosa desses tokens para cookies. Remover o armazenamento antigo não revoga, por si só, famílias históricas no servidor. Revogá-las pelos endpoints de sessões quando essa for a política da atualização.
6. Conferir login, reload, duas abas, logout e independência dos três portais no ambiente de homologação. As contas e segredos de testes não são configuração de produção.

## Aplicativos nativos

Morador e Operação conservam os endpoints JSON `/auth/login`, `/auth/refresh` e `/auth/logout`. Cada app tem seu próprio serviço de Keychain/Keystore: somente refresh persistido e access em memória. Fechar o processo não transfere sessão entre apps. Consulte os [requisitos móveis](../packages/mobile/README.md) e a [evidência de autenticação Android](../scripts/android-auth-smoke/README.md); aprovação de emulador não equivale a homologação iOS ou em aparelho físico.

## Proteção de tentativas de entrada

Após a migração `035-login-throttling.sql`, os dois endpoints de login compartilham contadores persistentes no PostgreSQL, inclusive entre portais, apps e processos da API. Cada rede inicia com 300 tentativas e repõe cinco por segundo; cada e-mail normalizado inicia com 20 e repõe uma a cada 45 segundos. São limites por baldes de fichas, não janelas que zeram num horário fixo. Tentativas bem-sucedidas também consomem capacidade. Senha correta não limpa o contador; recusa temporária não desativa a conta nem revoga sessões existentes.

A API consome rede primeiro, depois conta, antes de consultar a credencial e executar Argon2. Uma conta limitada ainda consome a capacidade da rede. A transação curta confirma a decisão antes de responder ou comparar senha. `429` traz `Retry-After` em segundos e mensagem genérica; respeitar a espera e exigir nova tentativa explícita, sem reenviar automaticamente login. Conta existente, ausente ou inativa recebe a mesma resposta quando limitada. Indisponibilidade do armazenamento produz `503` genérico e impede autenticação, sem registrar credenciais ou parâmetros do banco. Validação de origem/CSRF dos portais ocorre antes do consumo.

O corpo JSON de login aceita até 8 KiB, o e-mail até 254 bytes UTF-8 e a senha entre 1 e 1024 bytes UTF-8. A senha é comparada exatamente como enviada, sem trim; apenas o e-mail segue a normalização existente para minúsculas. IPv4 e sua forma IPv6 mapeada compartilham rede; demais endereços IPv6 são agrupados por prefixo /64. Endereço inválido usa uma única chave de fallback, nunca um contador novo por texto arbitrário.

`AUTH_RATE_LIMIT_KEY` é obrigatório em produção: gerar pelo menos 32 bytes aleatórios, codificados em base64url, e distribuir o mesmo segredo a todas as réplicas. Não reutilizar chaves JWT/MQTT nem senhas. Ausência, tamanho inválido ou a chave conhecida de desenvolvimento impedem a inicialização. Desenvolvimento/teste têm chave local fixa somente quando a variável está ausente. A tabela armazena HMAC SHA-256, tipo, saldo e datas; não guarda e-mail/IP legíveis, senha ou tokens. Rotacionar a chave reinicia os orçamentos, portanto coordenar a mudança entre réplicas; não usá-la para limpar um limite individual.

Os registros tornam-se elegíveis para remoção após 30 minutos sem atualização, quando sua capacidade já se recuperou. Cada tentativa remove até 32 registros expirados usando índice e ignorando linhas ocupadas. Expiração não garante remoção imediata em ambiente sem tráfego. Na manutenção, acompanhar quantidade de linhas, autovacuum e latência; uma limpeza administrativa deve selecionar lotes expirados, sem truncar a tabela ou apagar contadores ativos. Backup/restauração preserva contadores, funções, RLS e permissões; os três papéis de runtime não leem a tabela diretamente.

## Rede confiável do proxy

Execução direta ignora cabeçalhos encaminhados por padrão. Uma implantação própria pode definir `TRUST_PROXY_CIDRS` somente com IPs/CIDRs concretos dos proxies; booleanos, número de saltos, aliases e faixas universais são recusados.

No Compose de produção, somente Caddy e API participam de `edge_proxy`. O endereço estático `PROXY_IPV4_ADDRESS` do Caddy (padrão `172.30.250.2`) define automaticamente a única confiança `/32` da API. A rede padrão é `172.30.250.0/29`; em caso de colisão com VPS/VPN, mudar `PROXY_NETWORK_CIDR` e o endereço juntos. A API não publica porta no host. Caddy substitui `X-Forwarded-For` pelo peer real e remove `Forwarded` nas rotas normais e SSE; pedidos `/internal/*` são bloqueados na borda. Outro proxy/CDN à frente exige revisão explícita dessa topologia: a configuração atual contabiliza esse peer, sem confiar em cabeçalhos externos por conveniência.

`node scripts/test-production-proxy.mjs` verifica o Compose com valores sintéticos e executa os handlers reais do Caddy em rede descartável, sem portas publicadas nem emissão de certificados. O teste confirma substituição de cabeçalhos forjados e bloqueio das rotas internas. Ele exige Docker e redes de teste sem colisão; não usa o arquivo de produção nem comprova emissão TLS de um domínio público.

## Verificação e próximos fluxos

O backend web passou em dez testes HTTP/PostgreSQL específicos. A integração dos portais passou em **45/45 execuções dirigidas** nos três motores de navegador, com API real, além de **48/48** testes do cliente, **64/64** da UI, tipos e builds dos três portais. A regressão integral da API até 032 passou em **537/537**. A matriz completa de 105 execuções de navegador está em andamento; os resultados dirigidos não a substituem.

A comparação de senha executa trabalho Argon2 também para conta inexistente ou hash malformado, sem aceitar o resultado fictício como credencial. [Correção e testes](superpowers/plans/2026-10-02-password-verification-work.md). A limitação persistente passou 24 testes próprios, 29 de regressão de autenticação, teste do Caddy e 26 testes de banco com restauração de 44 tabelas/35 migrations. [Política e evidências de035](superpowers/plans/2026-10-02-login-throttling.md). MFA, verificação adicional para ações privilegiadas, convites e recuperação continuam pendentes da etapa 2C.
