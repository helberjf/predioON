# Suporte remoto pelo Prédio ON — AnyDesk

O painel **Administrador → Suporte remoto** permite cadastrar o computador de cada condomínio, preparar o acesso pelo AnyDesk e registrar o resultado dos atendimentos. O controle do computador acontece no cliente AnyDesk instalado; o Prédio ON não recebe nem guarda a senha desse acesso.

## Resumo para WhatsApp

1. Instalar o AnyDesk no computador do condomínio e no computador do técnico.
2. Configurar acesso não supervisionado, proteção da conta e início automático.
3. Manter o computador local ligado, com internet e acesso aos equipamentos.
4. Cadastrar nome e ID em Administrador → Suporte remoto.
5. Habilitar o suporte, registrar o motivo e clicar em Abrir AnyDesk.
6. Autenticar no AnyDesk, realizar a manutenção e registrar o resultado no Prédio ON.
7. Testar de outra internet e novamente após reiniciar o computador.

## Preparação da primeira instalação

Instalar a versão oficial do AnyDesk nas duas máquinas. No computador do condomínio, usar o modo instalado, que inicia com o sistema e permite retomar o acesso após reinicialização. Configurar acesso não supervisionado e testar sem alguém aceitar a conexão presencialmente. [Instalação](https://support.anydesk.com/portable-vs-installed) e [acesso não supervisionado](https://support.anydesk.com/unattended-access).

Usar senha exclusiva por instalação, autenticação em duas etapas e restringir os clientes autorizados conforme a equipe responsável. Guardar as credenciais em cofre de senhas da equipe, fora do cadastro e dos relatos do Prédio ON. O AnyDesk permite restringir conexões por ID ou alias. [Configurações oficiais](https://support.anydesk.com/settings).

O computador deve ficar ligado, conectado e sem suspensão; deve alcançar o gateway e os dispositivos que serão configurados. Instalar os programas dos fabricantes e registrar endereços locais, interfaces e versões. Salvar uma cópia da configuração antes de alterá-la. Testar a manutenção de outra conexão de internet e o retorno após reiniciar o computador.

O uso profissional exige licença adequada. Segundo o fabricante, a licença é necessária para os clientes que iniciam conexões comerciais; os que apenas recebem não precisam de licença própria. Dimensionar conforme técnicos, sessões simultâneas e dispositivos gerenciados. [Licenciamento oficial](https://support.anydesk.com/docs/how-does-the-anydesk-licensing-model-work).

## Cadastrar o computador

1. Entrar no painel de administrador da plataforma.
2. Abrir **Suporte remoto** e selecionar o condomínio.
3. Informar um nome claro, como “Computador da portaria”.
4. Copiar o ID numérico exibido pelo AnyDesk: 9 ou 10 números; espaços de apresentação são aceitos. Nesta versão, aliases e clientes com protocolo personalizado não são usados.
5. Marcar **Permitir solicitações de suporte neste condomínio** e salvar.

Existe um cadastro por condomínio. Salvar uma alteração gera uma nova revisão; o histórico conserva o nome e o ID usados no atendimento anterior. Não cadastrar um número fictício em um condomínio real.

## Iniciar e concluir o atendimento

1. Descrever o motivo e selecionar **Registrar solicitação e preparar acesso**.
2. Após o registro, clicar no link **Abrir AnyDesk**. O navegador pode solicitar confirmação para abrir o aplicativo instalado.
3. Autenticar no AnyDesk e conferir o nome do computador antes de modificar equipamentos.
4. Se o aplicativo não abrir, usar **Copiar ID cadastrado**, abrir o AnyDesk manualmente e colar o endereço. Se a cópia automática falhar, o painel mantém o ID selecionável.
5. Ao terminar, fechar a sessão no AnyDesk. No histórico do Prédio ON, abrir **Registrar resultado do atendimento**, escrever o relato e escolher **Resolvido**, **Pendente de solução** ou **Não foi possível conectar**.

O link segue o mecanismo oficial de abertura de sessão pelo navegador. Ele não leva senha. O segundo clique é intencional: o navegador recebe uma ação explícita do técnico para abrir outro aplicativo. [Documentação do mecanismo](https://support.anydesk.com/docs/url-handler).

“Solicitação registrada” não significa “computador conectado”. Os resultados são declarados pela equipe; não há confirmação automática de presença, duração ou gravação da sessão do AnyDesk. Encerrar a solicitação no Prédio ON registra seu resultado; não encerra a sessão no AnyDesk.

O autor pode preparar novamente uma solicitação aberta, desde que o cadastro permaneça habilitado e na mesma revisão. Depois de uma mudança, deve atualizar os dados e registrar outra solicitação. Outro administrador ativo pode registrar o resultado, mas prepara seu próprio pedido de acesso. O histórico exibe as últimas 50 solicitações por condomínio; os registros anteriores permanecem no banco.

## Permissões e revogação

Somente administradores ativos da plataforma consultam e gerenciam este módulo. Moradores e síndicos não recebem os dados do computador, relatos ou auditoria de suporte. O servidor verifica a situação atual do usuário a cada operação e o banco aplica a mesma restrição.

Desabilitar o cadastro impede preparar novas conexões pelo Prédio ON. Isso não revoga credenciais já conhecidas do AnyDesk, não encerra sessões existentes e não elimina um link já exibido em outra janela. Para revogar efetivamente um técnico, ajustar também as permissões, credenciais e autorizações no AnyDesk. Mudanças externas aparecem no painel ao usar **Atualizar dados**; preparar novamente uma solicitação consulta a configuração atual no servidor.

## Testes de instalação

- Acessar o computador de fora da rede e abrir o programa de configuração do equipamento.
- Reiniciar o computador e verificar que o acesso retorna sem login presencial.
- Confirmar que o ID cadastrado corresponde ao computador correto.
- Testar um técnico autorizado e a revogação de outro acesso de teste.
- Registrar um atendimento sem conexão e outro concluído, conferindo o histórico.
- Trocar entre dois condomínios e conferir que destino e histórico acompanham a seleção.

Sem internet ou energia, o acesso pode ficar indisponível. Se o monitoramento roda no gateway, deve continuar independente do computador de suporte. O heartbeat periódico do gateway é uma função separada e continua no [plano de comunicação e diagnóstico](superpowers/plans/2026-09-23-suporte-remoto-e-heartbeat.md).

## Instalação do módulo no servidor

A migração aditiva `infrastructure/010-support.sql` cria `support_hosts` e `support_requests`, índices, validações e políticas de acesso. Aplicar com o procedimento de migração do ambiente, depois publicar a API e o painel administrativo juntos. Na infraestrutura local, `pnpm db:infra` inclui automaticamente a décima migração. Não usar reset de banco para instalar o módulo.

Endpoints: `GET /support?buildingId=...`, `PUT /support/:buildingId`, `POST /support/:buildingId/requests` e `PATCH /support/:buildingId/requests/:id`. A solicitação usa `requestId` UUID para deduplicar tentativas; a configuração do servidor determina o destino. Resultado já encerrado é preservado, e reenviar o mesmo resultado não duplica auditoria.

O código e os testes locais não comprovam uma conexão ao computador real do condomínio. A instalação do AnyDesk, a licença e os ensaios de campo são necessários para liberar o atendimento real.

## Verificação local

Em 23/09/2026 foram conferidos no navegador cadastro, preparação do endereço `anydesk:`, encerramento manual, histórico, troca de condomínio e recuperação após falha de consulta. Nenhuma conexão externa foi iniciada; os dados temporários foram removidos. A regressão ampliada passou com 144 testes, incluindo os testes específicos de suporte, e tipos/build aprovados. Veja [Revisão de funcionalidades](REVISAO_FUNCIONALIDADES.md).
