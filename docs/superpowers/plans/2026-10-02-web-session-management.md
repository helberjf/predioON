# Gestão das próprias sessões nos portais

As APIs de listagem e revogação já existem e têm testes de isolamento. Este recorte acrescentou aos três portais a interface para reconhecer e encerrar conexões de outros dispositivos, usando as rotas atuais, sem alterar autorização, cookies ou banco.

## Comportamento

- Administração e operação recebem a página “Minhas sessões”; o perfil do morador apresenta o mesmo componente.
- A lista mostra origem informada pelo dispositivo, IP registrado, criação, última utilização, expiração e indicação da sessão atual. User-Agent é informação declarada pelo cliente, não identificação comprovada do aparelho.
- Mostrar somente sessões ativas inicialmente, com opção de histórico. Informar que a API lista as 100 conexões mais recentes; encerrar todas continua abrangendo todas as sessões da conta.
- Revogar uma sessão exige confirmação dentro da própria linha, com cancelamento sem requisição. Evitar envio duplicado enquanto a operação está pendente.
- Encerrar a atual ou todas remove a identidade local por `signOut`, propagando a saída às outras abas. Erro não apresenta sucesso; atualização/refoco consulta o servidor de novo.
- Nenhuma sessão de outro usuário, senha, refresh ou access token aparece na interface. Texto declarado pelo cliente é renderizado como texto React.

## Aceite

- [x] RED dos três percursos de navegador na fonte anterior à interface.
- [x] Revogar outro dispositivo sem afetar a sessão atual nem o usuário vizinho; confirmação cancelável e histórico sem controles de revogação.
- [x] Revogar todas e comprovar saída das abas e recusa do refresh de outro dispositivo.
- [x] Morador encerrar a atual pelo perfil e permanecer desconectado ao recarregar.
- [x] Concluir a saída depois de navegar por SPA durante a revogação pendente.
- [x] Administrador consultar a própria conexão; falha da consulta mostra erro, remove ações e permite recuperação sem simular lista vazia.
- [x] GREEN em Chromium, Firefox e WebKit, tipos/builds e revisão independente.

Sem mudanças da API/SQL durante a regressão de033. Interface de sessões nativas, MFA, recuperação e convites são recortes separados ainda pendentes.

## Fundação de conclusão da revogação

A revisão do primeiro rascunho encontrou um caso de navegação: sair da tela durante a requisição podia impedir a limpeza local depois da revogação remota. O provider de autenticação agora oferece `signOutAfter(operation)`, que captura sua geração antes de iniciar a operação e conclui a saída mesmo quando a tela iniciadora foi desmontada. Uma autenticação/restauração posterior substitui essa geração e nunca é encerrada pelo retorno antigo. Falha da operação propaga o erro sem anunciar saída.

Quatro testes falharam antes da implementação e passaram depois; o conjunto dirigido com os testes anteriores de identidade passou em **11/11**. Tipos UI passaram e a árvore integrada passou em **73/73**, incluindo cinco testes de ações por recurso então em outra entrega. Revisão independente aprovou a proteção por geração. Essa fundação foi publicada separadamente em `aea040d`.

## Evidência da interface

Os três testes iniciais reprovaram no snapshot da UI `ce18474` com API/SQL033: não existiam o link “Minhas sessões” nem o controle de encerramento no perfil. O RED foi preservado em `.local/playwright-report-ui-three-scopes-red`, resultados e log correspondentes. O teste de navegação pendente foi acrescentado para cobrir o achado da revisão; o quinto caso exercita o portal de administração e a recuperação após falha de leitura.

Com a interface integrada, os **15/15 testes** (cinco por navegador) passaram em Chromium, Firefox e WebKit, em1,5min, com zero retries/skips. Login, listagem e revogação usam API/PostgreSQL reais. O caso de navegação apenas atrasa o envio da requisição real; a injeção503 é explícita no teste da falha de leitura. Fixtures e sessões são isoladas e removidas no finally. Relatórios: `.local/playwright-report-sessions-green`, `.local/playwright-results-sessions-green` e `.local/sessions-green.log`.

A regressão de cookies, renovação e coordenação entre abas também passou **24/24** nos três navegadores após a integração da fundação e da tela, em3min, sem retries/skips. Artefatos em `.local/playwright-report-cookies-session-regression`, resultados e log correspondentes. A API e o banco dessa stack permaneceram congelados em033, sem a migração física034 em desenvolvimento paralelo.

Passaram os tipos de contratos/UI/três portais, tipos E2E, os três builds Vite e as fronteiras de pacotes. Os builds ainda emitem avisos de tamanho de bundle já registrados. Revisão independente final não encontrou bloqueador. O resultado cobre gestão de sessões nos três portais; interface de sessões nativas, MFA, recuperação e convites seguem pendentes.
