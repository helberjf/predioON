# Autenticação e sessões

Cada login cria uma sessão independente. O access token EdDSA contém apenas `sub` e `sid`, tem emissor e audiência `predioon-api` e dura cinco minutos por padrão. A API lê a sessão, a conta e os vínculos ativos no banco a cada requisição; revogar uma sessão, desativar uma conta ou encerrar um vínculo vale sem esperar o JWT vencer.

O refresh token é opaco e só seu SHA-256 é armazenado. Cada família tem expiração absoluta, sem extensão ao rotacionar. Uma rotação consome o token e grava o sucessor numa transação que trava a sessão. Reutilizar um token consumido revoga toda a família, inclusive o sucessor; a revogação é confirmada antes da resposta 401. Um cliente deve serializar suas renovações: se perder a resposta e reapresentar o token antigo, deverá fazer login novamente.

`GET /auth/sessions` retorna `{ "items": [...] }` com até as 100 sessões próprias mais recentes e `current`. `DELETE /auth/sessions/:id` revoga uma sessão própria; outra pessoa recebe 404. `POST /auth/sessions/revoke-all` encerra todas as sessões da conta, inclusive a atual. `POST /auth/logout` aceita qualquer refresh token conhecido da família, mesmo já consumido.

## Chaves e implantação

Em produção, configure `JWT_ACTIVE_KID`, `JWT_PRIVATE_KEY` (Ed25519 PKCS#8 PEM) e `JWT_PUBLIC_KEYS` (objeto JSON de `kid` para chave pública SPKI PEM). Valores PEM podem usar `\n` literais nas variáveis. A chave pública ativa deve corresponder à privada; outras entradas públicas verificam tokens emitidos antes da rotação até expirarem. Falta, formato inválido ou par incompatível impedem a inicialização. Não registre ou distribua a chave privada.

Em desenvolvimento, sem as três variáveis, um par efêmero é gerado na inicialização. Reiniciar o processo invalida os access tokens locais. `JWT_ACCESS_TTL_MINUTES` aceita ajuste operacional, com padrão de cinco minutos. `JWT_REFRESH_TTL_DAYS` define a expiração absoluta da família.

A migração `infrastructure/013-sessions.sql` é aditiva. Refresh tokens anteriores não têm `session_id` e falham fechados. JWTs HS256 antigos também falham fechados. A transição exige um novo login uma vez; não há janela de compatibilidade que permita contornar a revogação de sessão. O armazenamento web em cookie seguro e a adaptação mobile são etapas posteriores do plano de identidade.
