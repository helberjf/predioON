# Gestão das próprias sessões nos portais

As APIs de listagem e revogação já existem e têm testes de isolamento. Os portais ainda não permitem ao usuário reconhecer ou encerrar uma conexão de outro dispositivo. Este recorte adiciona essa interface aos três portais usando as rotas atuais, sem alterar autorização, cookies ou banco.

## Comportamento

- Administração e operação recebem a página “Minhas sessões”; o perfil do morador apresenta o mesmo componente.
- A lista mostra origem informada pelo dispositivo, IP registrado, criação, última utilização, expiração e indicação da sessão atual. User-Agent é informação declarada pelo cliente, não identificação comprovada do aparelho.
- Mostrar somente sessões ativas inicialmente, com opção de histórico. Informar que a API lista as 100 conexões mais recentes; encerrar todas continua abrangendo todas as sessões da conta.
- Revogar uma sessão exige confirmação dentro da própria linha, com cancelamento sem requisição. Evitar envio duplicado enquanto a operação está pendente.
- Encerrar a atual ou todas remove a identidade local por `signOut`, propagando a saída às outras abas. Erro não apresenta sucesso; atualização/refoco consulta o servidor de novo.
- Nenhuma sessão de outro usuário, senha, refresh ou access token aparece na interface. Texto declarado pelo cliente é renderizado como texto React.

## Aceite

- [ ] RED dos três percursos de navegador na fonte anterior à interface.
- [ ] Revogar outro dispositivo sem afetar a sessão atual nem o usuário vizinho; confirmação cancelável e histórico sem controles de revogação.
- [ ] Revogar todas e comprovar saída das abas e recusa do refresh de outro dispositivo.
- [ ] Morador encerrar a atual pelo perfil e permanecer desconectado ao recarregar.
- [ ] GREEN em Chromium, Firefox e WebKit, tipos/builds e revisão independente.

Sem mudanças da API/SQL durante a regressão de033. Interface de sessões nativas, MFA, recuperação e convites são recortes separados ainda pendentes.

## Fundação de conclusão da revogação

A revisão do primeiro rascunho encontrou um caso de navegação: sair da tela durante a requisição podia impedir a limpeza local depois da revogação remota. O provider de autenticação agora oferece `signOutAfter(operation)`, que captura sua geração antes de iniciar a operação e conclui a saída mesmo quando a tela iniciadora foi desmontada. Uma autenticação/restauração posterior substitui essa geração e nunca é encerrada pelo retorno antigo. Falha da operação propaga o erro sem anunciar saída.

Quatro testes falharam antes da implementação e passaram depois; o conjunto dirigido com os testes anteriores de identidade passou em **11/11**. Tipos UI passaram e a árvore integrada passou em **73/73**, incluindo cinco testes de ações por recurso ainda em outra entrega. Revisão independente aprovou a proteção por geração. A fundação não comprova o funcionamento visual da página; os percursos Playwright acima continuam pendentes.
