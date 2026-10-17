# Pedido de recuperação de senha nos dois aplicativos

Recorte da identidade e dos clientes móveis da arquitetura aprovada de produto. A API047 já oferece recuperação por e-mail; este trabalho fecha o acesso a esse fluxo na entrada dos aplicativos Morador e Operação, sem acrescentar serviços ou dependências.

## Experiência

O botão **Esqueci minha senha** abre um formulário de e-mail. O formulário permite enviar um pedido e voltar à entrada. O link recebido por e-mail continua abrindo o portal existente, onde a senha é redefinida; depois a pessoa entra novamente no aplicativo. O aplicativo não recebe o segredo do link nem pede uma nova senha nesse fluxo.

Usar os componentes, estilos e comportamento do teclado já existentes. Ao abrir recuperação, desmontar a entrada e descartar senha/código MFA. Voltar cria uma entrada nova. Não permitir sair da entrada enquanto um login iniciou; uma guarda síncrona cobre o intervalo anterior ao render de `pending`.

O formulário limita o e-mail a 254 caracteres, normaliza espaços externos e valida seu formato básico antes do envio; o servidor continua sendo a autoridade de validação. Uma guarda síncrona impede envio duplicado no mesmo tick. Durante envio, bloquear edição e outro envio, conservando a opção de voltar/cancelar.

Após204, mostrar a mesma resposta para qualquer conta: **Se este e-mail tiver uma conta, você receberá um link para criar uma nova senha. Ele vale por 60 minutos. Confira também a caixa de spam.** Não afirmar entrega comprovada nem mostrar se a conta existe. Informar que a pessoa redefine a senha pelo link e retorna ao app.

## Transporte e segurança

Uma função pública pequena em `packages/api-client` faz exclusivamente `POST /auth/password/forgot` e usa `PasswordForgotRequest` já existente. Não usar `api.post`: o motor autenticado lê tokens, renova a sessão e pode repetir uma chamada401. O helper público não lê/escreve Keychain/Keystore, não recebe tokens ou callbacks de sessão, não renova e não repete pedidos.

Usar somente a origem de API já validada pelo aplicativo e o `boundedFetch` existente, com prazo de20s e sinal de cancelamento. O request contém apenas e-mail, Content-Type JSON, `credentials: omit`, `cache: no-store` e `redirect: error`. Não forjar Origin nem enviar destino de portal, Cookie ou Authorization.

Somente204 confirma o pedido. Status400,429 e demais erros têm mensagens fixas; não interpretar nem exibir o corpo de erro, que pode conter informação privada. Outros2xx são resposta inválida. Nenhum erro modifica a sessão ou o MFA.

Voltar, desmontar, mudar contexto ou suspender a tela invalida a geração e cancela o transporte. Uma resposta antiga não pode atualizar outra tela ou um formulário reaberto. O ciclo dos effects deve admitir StrictMode sem deixar o controller definitivamente inutilizável.

## Estrutura

- `packages/api-client/src/index.ts`: helper público isolado; engine/web-client e manifestos intactos.
- `packages/mobile/src/login.tsx`: entrada atual extraída, alternância com recuperação e lógica MFA preservada.
- `packages/mobile/src/app.tsx`: usa a entrada compartilhada e injeta o transporte com a origem validada.
- `packages/mobile/src/password-recovery.ts`: controller e validação.
- `packages/mobile/src/password-recovery-screen.tsx`: formulário compartilhado.
- Testes de contrato HTTP, controller e interação dos componentes renderizados, com host React Native instrumentado.

## Aceite

Testar os dois produtos em Android/iOS no host instrumentado: botão, formulário, validação, envio/feedback, double tap/submit, bloqueio durante envio, cancelamento, resposta tardia, reabertura limpa, login normal e solicitação de código MFA. Verificar transporte sem sessão/cookies/retries, cancelamento, erro de rede, status400/401/403/429/503,2xx inesperados e corpos que ecoam segredos sem exposição à UI.

Executar as integrais de cliente HTTP e mobile, tipos dos consumidores móveis, fronteiras e bundles JavaScript de release dos dois produtos. Revisão independente de conformidade e qualidade antes do commit/push.

## Limites

Sem nova migration, provedor, pacote, deep link nativo ou implementação push. `PASSWORD_RESET_URL` precisa ser configurado pelo proprietário ao ativar Resend: pedidos nativos não fornecem Origin de portal, e a API usa esse destino confiável. Sem chave/domínio/destino configurados,204 não prova envio. Os testes de host e bundles não aceitam Fabric, aparelhos, Apple/XCTest ou entrega real de e-mail.
