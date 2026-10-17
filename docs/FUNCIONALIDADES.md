# Controle de funcionalidades

Revisão de 17/10/2026, sobre o código até a migration 051. A administração da plataforma controla 23 funcionalidades em **Administração → Funcionalidades** (`/funcionalidades`, painel administrativo). O controle afeta o software; não desliga fisicamente equipamentos.

**Mudanças desde a revisão de 24/09:** portões e vagas passaram a vir **desligados por padrão**, inclusive em instalações que já existiam (migrations 049 e 050). A permissão de alterar deixou de ser conferida pelo papel e passou a ser a capacidade vigente `features:manage`. Desligar um recurso também cancela entregas de alerta que deixaram de valer. O consumo para moradores ganhou uma liberação própria, decidida pelo síndico e desligada por padrão (migration 051), e o morador deixou de ver o nível da caixa d'água.

## Passo a passo rápido

1. Entre no painel administrativo com uma conta de administrador da plataforma.
2. Abra **Funcionalidades** e escolha **Global · todos os condomínios** ou o condomínio em **Onde aplicar**.
3. Escolha **Ativar**, **Desativar** ou, no condomínio, **Herdar global**.
4. Leia os efeitos, preencha a justificativa e confirme a alteração.
5. Confira o estado efetivo, o motivo de eventual bloqueio e os portais do síndico e do morador.
6. Ao reativar sensores, aguarde novas leituras válidas e confira medidores e vagas antes de liberar o uso.

## Quem pode alterar e como a decisão é tomada

A API exige a capacidade global `features:manage`, que pertence ao papel Administrador da plataforma. A capacidade é conferida no banco no momento da alteração, inclusive a vigência do vínculo: revogar o papel ou desativar a conta impede novas alterações mesmo com uma sessão ainda aberta. Contas apenas comerciais (Clientes) não veem a tela. Síndicos, equipe e moradores consultam somente o estado efetivo do condomínio a que têm vínculo vigente.

| Configuração global | Preferência do condomínio | Resultado |
|---|---|---|
| Ativa | Herdar global | Disponível, respeitando dependências |
| Ativa | Ativar | Disponível, respeitando dependências |
| Ativa | Desativar | Bloqueada no condomínio |
| Desativada | Qualquer preferência | Bloqueada globalmente |

O desligamento global é teto: enquanto valer, nenhum condomínio liga o recurso localmente, e a preferência local fica preservada para quando o global voltar. Agrupamento e gravidade dependem de chamados. Transparência e prestação de contas são independentes. Ativar um recurso não habilita automaticamente um equipamento ou portão desativado em seu cadastro.

### Estado inicial

| Funcionalidades | Global | Condomínios |
|---|---|---|
| Portão da garagem, portão de pedestres, vagas de carros, vagas de motos | **Desligadas** (049 em instalação nova; 050 em instalação existente) | Herdam |
| As outras 19 | Ligadas (sem configuração gravada, regra da 012) | Herdam |

Portões e vagas só devem ser ligados quando o condomínio tiver de fato o equipamento instalado e testado. Desligados, Acessos e Vagas somem dos portais web, a aba Acessos some do app Morador, a API recusa as rotas e a ingestão descarta as leituras desses módulos. Cadastros de portões, vagas e equipamentos continuam guardados para quando forem ligados.

## Catálogo

| Área | Controles separados |
|---|---|
| Monitoramento | Caixa d'água; consumo de água; consumo de energia; fases e parâmetros elétricos; bomba; vazamento de água; vazamento de esgoto; fumaça; temperatura; gás; análise de desvios por IA |
| Acessos e vagas | Portão da garagem; portão de pedestres; vagas de carros; vagas de motos |
| Rotina | Avisos; reservas de áreas comuns; chamados |
| Atendimento | Agrupamento de chamados repetidos; seleção e alteração de gravidade |
| Administração | Transparência da gestão; prestação de contas; suporte remoto |

Ficam fora da central e sempre disponíveis, sujeitos apenas às permissões de cada pessoa: entrada, recuperação de senha, verificação em duas etapas, sessões, usuários e convites de moradores, condomínios, blocos, unidades e equipes, clientes, auditoria, a própria central, comunicação dos gateways, ordens de serviço, ativos e automações. Uma automação que abre ordem de serviço a partir de um alerta depende do alerta, e o alerta segue o controle do sensor correspondente. A configuração técnica dos equipamentos também permanece acessível à equipe autorizada. Disjuntor/extintor permanece fora do escopo.

## Consumo para moradores (liberação do síndico)

Não faz parte das 23 funcionalidades da central: é uma liberação por condomínio, decidida pela administração do condomínio e **desligada por padrão**. Fica no portal de operação, em **Consumo e análise**, no cartão **Consumo para moradores**, com o botão **Liberar para moradores**. Só aparece para quem administra o condomínio e lê as medições.

| Situação | O que o morador vê |
|---|---|
| Não liberado (padrão) | Nada de consumo; o item **Consumo** nem aparece no portal do morador. |
| Liberado | Quantidade diária de energia e de água dos últimos 7 dias, somando os medidores do mesmo tipo; dias afetados por pausa aparecem como **parcial**. Nunca tarifa, custo, limite, bomba, referência aprendida, leitura bruta ou identificação de equipamento. |

A liberação depende também das funcionalidades da central: com consumo de água ou de energia desligado, aquele tipo não é mostrado. Cada mudança grava `RESIDENT_CONSUMPTION_CHANGED` na auditoria, com valor anterior e novo. Retirar a liberação, ou o morador perder o vínculo, encerra o acesso na consulta seguinte. O nível da caixa d'água não é mais entregue ao morador em nenhum caso. O app Morador não tem tela de consumo.

## Alteração e auditoria

Cada mudança exige justificativa de 3 a 1.000 caracteres. A confirmação informa o escopo e os efeitos concretos, inclusive as funcionalidades dependentes que ficam indisponíveis. O registro de auditoria `FEATURE_CONFIGURATION_CHANGED` guarda autor, horário, escopo/condomínio, recurso, motivo, valores anterior e novo, versão e quantos condomínios mudaram de estado efetivo. As mudanças feitas pela migration 050 aparecem com ator `SYSTEM` e motivo "Migration 050: portões e vagas desligados por padrão". Se outra pessoa salvar a mesma configuração antes, o servidor retorna conflito; a tela recarrega o estado e exige uma nova escolha, sem sobrescrever silenciosamente.

Nos portais web, menus, atalhos, cartões e controles acompanham a disponibilidade. A URL direta mostra que a funcionalidade está desativada e a API bloqueia a operação mesmo que a tela ainda esteja aberta. Mudanças notificam os portais em tempo real; também há reconciliação ao recuperar foco e a cada 30 segundos. Falhas ao consultar a configuração impedem a exibição dos módulos até uma nova consulta válida.

Os apps Morador e Operação consultam o estado do condomínio escolhido e escondem Avisos, Solicitações, Reservas e Acessos desligados. Ordens de serviço no app Operação seguem só as permissões.

## O que acontece durante a pausa

| Recurso desativado | Efeito |
|---|---|
| Sensores e medidores | As novas leituras correspondentes são descartadas, sem armazenamento ou recuperação posterior. Em uma mensagem mista, métricas de recursos habilitados continuam sendo processadas. Heartbeat e comunicação dos equipamentos continuam ativos. |
| Monitoramento | Cálculos, regras e novos alertas do recurso ficam suspensos. A pausa aguarda um envio de webhook já iniciado e cancela em definitivo, na mesma transação, as entregas pendentes que deixaram de ser elegíveis (`FEATURE_INELIGIBLE`); a elegibilidade também é conferida de novo antes de cada envio. Retomar não reenvia esses alertas. |
| Apenas IA | Leituras e limites convencionais dos recursos habilitados continuam ativos; a análise adaptativa e seus alertas ficam suspensos. |
| Portões | Novos pedidos são bloqueados. Pedidos ainda pendentes são cancelados e auditados (`ACCESS_COMMAND_CANCELLED_BY_FEATURE`). A desativação é coordenada com o despacho: comandos já enviados podem concluir e continuam recebendo confirmação. Não são reenviados na retomada. |
| Vagas | Contagens ficam indisponíveis e a ocupação passa a desconhecida. Capacidade e configuração são preservadas. |
| Chamados | Novas operações e consultas ficam bloqueadas. Chamados existentes não são encerrados. Agrupamento e gravidade ficam indisponíveis por dependência. |
| Apenas agrupamento | Impede novas sugestões e ações coletivas; vínculos existentes são preservados. |
| Apenas gravidade | Novos chamados recebem gravidade **Média**. Valores e histórico dos chamados anteriores são preservados. |
| Transparência | Atualizações de gestão, inclusive avisos da categoria `GESTAO`, ficam indisponíveis. Avisos comuns seguem o controle Avisos. Prestação de contas segue seu próprio controle. |
| Reservas, avisos e contas | Registros anteriores permanecem armazenados, sem cancelamento ou resolução automática. |
| Suporte remoto | Bloqueia novas solicitações. Sessões externas do AnyDesk já iniciadas não são encerradas; o resultado de uma solicitação existente ainda pode ser registrado pela API autorizada. |

Não use o controle para desligar uma bomba, cortar alimentação ou interromper uma abertura já enviada. Essas ações físicas dependem dos equipamentos e procedimentos locais.

## Retomada

1. Reative o recurso no escopo adequado e confira se há bloqueio global ou dependência.
2. O histórico preservado volta às consultas. Leituras atrasadas anteriores à retomada são recusadas para impedir que uma fila recomponha o período pausado.
3. Medidores estabelecem uma nova referência a partir da primeira amostra válida. A diferença acumulada durante a pausa não vira consumo ou tempo de bomba; o intervalo não é preenchido com zeros.
4. Dias de medição afetados ficam identificados como incompletos e são excluídos do aprendizado automático. Comparações adaptativas não usam esses períodos como referência normal.
5. Vagas voltam como desconhecidas até uma contagem válida posterior à retomada, manual ou por sensor. Nunca presumir zero ocupação.
6. Confirme leituras, horário, configuração do equipamento e permissões de acesso antes de concluir a manutenção.

## API para integração

| Método e rota | Acesso |
|---|---|
| `GET /features/catalog` | `features:manage`; catálogo e dependências |
| `GET /features/global` | `features:manage`; configuração global |
| `GET /features/buildings/:buildingId` | Vínculo vigente no condomínio ou administração da plataforma; estado efetivo |
| `PUT /features/global/:key` | `features:manage`; estado global booleano |
| `PUT /features/buildings/:buildingId/:key` | `features:manage`; `true`, `false` ou `null` para herdar |
| `GET` e `PUT /monitoring/resident-access` | Administração do condomínio com leitura de medições; estado e mudança da liberação de consumo (`{"buildingId":"…","released":true}`) |
| `GET /monitoring/published?buildingId=…` | Capacidade `monitoring:read-published` (morador; o síndico também a tem), só com a liberação ligada; projeção reduzida de consumo |

Exemplo de corpo: `{"enabled":false,"version":0,"reason":"Manutenção do medidor de água"}`. Use a versão devolvida pela consulta, nunca um número fixo na integração. As respostas de configuração incluem estado efetivo, preferência global/local, motivo de bloqueio, versões e data de retomada. Operações bloqueadas retornam HTTP `403` com `details.code = FEATURE_DISABLED`, após autorização. Conflitos retornam `409` com `details.code = FEATURE_VERSION_CONFLICT`.

## Implantação e teste de aceitação

As migrations do controle são a 012 (tabelas e transições), 016 e 021 (autorização por capacidade e vigência), 038 (cancelamento de entregas de alerta), 049 e 050 (portões e vagas desligados) e 051 (liberação de consumo para moradores). Aplicar com `pnpm db:infra` pelo procedimento de [DEPLOY](DEPLOY.md) e [MIGRATIONS](MIGRATIONS.md), atualizando API e ingestão conjuntamente antes de liberar a central. Não apagar dados, não executar reset e não usar seed de demonstração em produção.

**Ao aplicar a 050 numa instalação em uso:** portões e vagas saem do ar em todos os condomínios onde estavam ligados, pendentes de portão são cancelados e a ocupação das vagas fica desconhecida. Uma configuração global já gravada por alguém, ligada ou desligada, é mantida. Para religar, use a central.

**Ambientes de teste e demonstração:** o seed só liga portões e vagas, e só cria seus equipamentos de demonstração, com `SEED_PHYSICAL_FEATURES=enabled pnpm db:seed` (já configurado nos workflows de CI).

Em um condomínio de homologação: desative um sensor, envie um lote misto, confira descarte seletivo e heartbeat; reative e confirme nova referência do medidor. Verifique bloqueio por URL/API nos portais e nos apps, histórico preservado e auditoria. Para portões e vagas, ligue-os antes no escopo de teste; use controlador de teste, incluindo um pedido pendente e um já enviado, e confirme vagas desconhecidas após a retomada. Para o consumo do morador, confira que nada aparece antes da liberação, que só quantidades aparecem depois e que tudo some ao retirá-la. A validação do software não substitui testes dos equipamentos instalados.
