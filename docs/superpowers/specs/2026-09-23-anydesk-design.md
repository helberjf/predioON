# Suporte remoto pelo Prédio ON

Decisão autorizada em 23/09/2026: integrar o cliente AnyDesk instalado. O administrador seleciona o condomínio, cadastra o nome e ID numérico do computador, habilita o suporte, informa o motivo e registra a solicitação. Um link explícito abre o cliente AnyDesk. O técnico registra depois o resultado do atendimento. Autenticação e controle remoto continuam no AnyDesk; o app não armazena sua senha nem confirma automaticamente uma conexão.

O módulo fica no painel da plataforma, com uma configuração por condomínio, histórico dos últimos 50 atendimentos, auditoria e verificação do administrador ativo no banco a cada operação. Moradores e síndicos não acessam o cadastro ou histórico. RLS protege as tabelas mesmo fora das rotas. Desabilitar no app impede novas solicitações no app; revogar acesso real exige também fazê-lo no AnyDesk.

O ID aceita 9 ou 10 dígitos e espaços de apresentação; URLs, senhas, parâmetros e aliases não são aceitos nesta versão. O destino é obtido da configuração no servidor. Solicitações usam UUID de idempotência e preservam uma cópia do destino e nome utilizados. Mudança de configuração impede reutilizar uma solicitação antiga para abrir um destino anterior. Resultados manuais: resolvido, pendente ou não foi possível conectar. Repetir o mesmo resultado é idempotente; alterar atendimento encerrado é recusado.

O lançamento usa um segundo clique em link nativo depois do registro, preservando o gesto do usuário exigido pelo navegador. Há cópia do ID, instruções de instalação e tratamento de indisponibilidade. Ao trocar de condomínio, os estados de formulário e lançamento são descartados, incluindo respostas assíncronas anteriores. O link não transporta credenciais.

Ficam fora desta entrega: instalação em computadores externos, compra de licença, sessão de suporte real sem destino fornecido, visualização da tela remota dentro do navegador e mudanças no heartbeat. Esses itens não impedem entregar e testar o módulo local.

Fonte verificada: [links para iniciar conexão no AnyDesk](https://support.anydesk.com/docs/url-handler). O suporte a links depende do cliente instalado no computador do técnico.
