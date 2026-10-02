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
- [ ] Adaptador web com access em memória, remoção dos tokens antigos de localStorage, renovação serializada entre abas do mesmo portal, invalidação em troca de identidade e logout.
- [ ] Restaurar sessão após reload usando cookie e atualizar testes web/SSE. Não persistir access nem refresh em storage, URL ou logs.
- [ ] Playwright nos três navegadores: login, reload, logout, duas abas, dois portais, renovação concorrente, perda de sessão e ataques CSRF negativos; builds/typechecks e regressões relevantes.
- [ ] Atualizar documentação de implantação e migração, distinguindo backend disponível de portais efetivamente migrados.

Referências consultadas: [MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie) e [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html). A defesa usa cabeçalho customizado sujeito a preflight, validação de origem e SameSite; não introduz token CSRF em localStorage.

## Evidências do backend — 02/10/2026

Dez testes HTTP/DB passaram, incluindo rollback real por falha injetada na rotação, preservando cookie recuperável. A execução dirigida com ciclo de sessões e assinatura JWT passou em 23/23. Typechecks API/contratos e fronteiras passaram. Revisão independente não encontrou bloqueadores no backend; destacou obrigatoriedade de `credentials: include`, site HTTPS comum e serialização entre abas no cliente. O frontend ainda usa o adaptador anterior; a migração dos portais permanece pendente e deve ser validada em Playwright antes de anunciar a remoção de localStorage como entregue.
