# Sessões web com cookie e proteção CSRF

Recorte da etapa 2C. Não encerra MFA, convites, recuperação ou limites de tentativas.

## Contrato

- Introduzir `/auth/web/login`, `/refresh` e `/logout`, preservando os endpoints JSON usados pelos aplicativos nativos.
- Refresh somente em cookie HttpOnly, sem Domain, SameSite=Strict e Secure em HTTPS/produção. Em produção usar prefixo `__Host-` e Path=/ para impedir cookies de domínio pai; a API lê esse cookie somente em `/auth/web`. HTTP permitido apenas para origens loopback de desenvolvimento/teste.
- Cookie independente por origem permitida, com nome derivado de SHA-256, para que os três portais não sobrescrevam sessões uns dos outros. Origem é configuração administrativa, nunca host arbitrário do pedido.
- Exigir Origin exata autorizada, cabeçalho não simples `X-Predioon-Web: 1`, Content-Type JSON e recusar Fetch Metadata cross-site. Não usar Origin, Referer ou CORS isoladamente como prova de identidade. CORS deve manter lista exata e credenciais; implantação web e API no mesmo site HTTPS.
- Resposta web contém apenas accessToken e identidade. Login/refresh usam o serviço real de sessões, validade absoluta, rotação e revogação atuais. Token expirado/reutilizado limpa o cookie; falha transitória não destrói a sessão recuperável. Logout é idempotente e revoga a família corrente.
- Nenhuma rota de domínio aceita cookie como autenticação: continuam exigindo bearer em memória.

## Implementação e verificação

- [x] Testes HTTP RED para proteção de origem/cabeçalho/formulário, ausência de refresh no JSON, cookie seguro, rotação/replay, expiração, logout e isolamento entre portais.
- [x] Backend web e contrato público sem mudança dos fluxos nativos; testes dirigidos e revisão independente.
- [x] Adaptador web com access em memória, remoção dos tokens antigos de localStorage, renovação serializada entre abas do mesmo portal, invalidação em troca de identidade e logout.
- [x] Restaurar sessão após reload usando cookie e atualizar testes web/SSE. Não persistir access nem refresh em storage, URL ou logs.
- [x] Playwright nos três navegadores: login, reload, logout, duas abas, dois portais, renovação concorrente, perda de sessão e ataques CSRF negativos; builds/typechecks e regressões relevantes.
- [x] Atualizar documentação de implantação e migração, distinguindo backend disponível de portais efetivamente migrados.

Referências consultadas: [MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie) e [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html). A defesa usa cabeçalho customizado sujeito a preflight, validação de origem e SameSite; não introduz token CSRF em localStorage.

## Evidências do backend — 02/10/2026

Dez testes HTTP/DB passaram, incluindo rollback real por falha injetada na rotação, preservando cookie recuperável. A execução dirigida com ciclo de sessões e assinatura JWT passou em 23/23. Typechecks API/contratos e fronteiras passaram. Revisão independente não encontrou bloqueadores no backend; destacou obrigatoriedade de `credentials: include`, site HTTPS comum e serialização entre abas no cliente. O backend foi publicado antes da troca de adaptador dos portais.

## Integração dos portais — 02/10/2026

Fundação publicada em `21706c8`; integração dos três portais em `ce18474`. O cliente passou em 48/48, UI em 64/64, tipos dos consumidores e três builds web passaram. A fachada nativa conserva 51/51 testes móveis e bundles Metro dos dois apps. A API até 032/cookies passou em 537/537.

Quinze cenários de autenticação/isolamento passaram em cada um dos três motores: **45/45**, sem retries ou skips, com API e PostgreSQL reais. Incluem cookie inacessível ao JavaScript, limpeza dos tokens anteriores, SSE sem token na URL, reload, duas abas simultâneas, troca de identidade, portais independentes, logout offline, revogação de família, CSRF e navegador sem Web Locks. Os relatórios locais estão em `.local/playwright-report-cookies-windows` e `.local/playwright-report-cookies-webkit`, fora do Git.

Os testes do cliente também verificam espera limitada durante headers/corpo, falha de persistência após login e descarte de resposta antiga sem apagar uma identidade mais nova. LocalStorage conserva apenas época/intenção de logout; não há compartilhamento de tokens entre abas. O procedimento para domínio/site, atualização e invalidação das sessões antigas está em [AUTENTICACAO](../../AUTENTICACAO.md).

A matriz completa de navegação com 35 cenários/105 execuções está em andamento sobre `ce18474`. Ela inclui domínios além deste recorte e terá seu resultado registrado separadamente.
