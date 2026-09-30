# Controle de funcionalidades

Revisão de 24/09/2026. O administrador da plataforma controla 23 funcionalidades em **Administração → Funcionalidades** (`/funcionalidades`). O controle afeta o software; não desliga fisicamente equipamentos.

## Passo a passo rápido

1. Entre no painel administrativo com uma conta ativa de administrador da plataforma.
2. Abra **Funcionalidades** e escolha **Global** ou o condomínio em **Onde aplicar**.
3. Escolha **Ativar**, **Desativar** ou, no condomínio, **Herdar global**.
4. Leia os efeitos, preencha a justificativa e confirme a alteração.
5. Confira o estado efetivo, o motivo de eventual bloqueio e os portais do síndico e do morador.
6. Ao reativar sensores, aguarde novas leituras válidas e confira medidores e vagas antes de liberar o uso.

## Quem pode alterar e como a decisão é tomada

Somente `PLATFORM_ADMIN` ativo no banco pode administrar os controles. Revogar esse papel ou desativar a conta impede novas alterações mesmo com um token ainda válido. Síndicos e moradores consultam somente a disponibilidade do próprio condomínio.

| Configuração global | Preferência do condomínio | Resultado |
|---|---|---|
| Ativa | Herdar global | Disponível, respeitando dependências |
| Ativa | Ativar | Disponível, respeitando dependências |
| Ativa | Desativar | Bloqueada no condomínio |
| Desativada | Qualquer preferência | Bloqueada globalmente |

A preferência local é preservada durante um bloqueio global. Agrupamento e gravidade dependem de chamados. Transparência e prestação de contas são independentes. Os controles começam habilitados globalmente e os condomínios começam herdando essa configuração. Ativar um recurso não habilita automaticamente um equipamento ou portão desativado em seu cadastro.

## Catálogo

| Área | Controles separados |
|---|---|
| Monitoramento | Caixa d'água; consumo de água; consumo de energia; fases e parâmetros elétricos; bomba; vazamento de água; vazamento de esgoto; fumaça; temperatura; gás; análise de desvios por IA |
| Acessos e vagas | Portão da garagem; portão de pedestres; vagas de carros; vagas de motos |
| Rotina | Avisos; reservas de áreas comuns; chamados |
| Atendimento | Agrupamento de chamados repetidos; seleção e alteração de gravidade |
| Administração | Transparência da gestão; prestação de contas; suporte remoto |

Login, usuários, cadastro de condomínios, auditoria, central de funcionalidades e comunicação dos gateways continuam disponíveis. A configuração técnica dos equipamentos também permanece acessível à equipe autorizada. Disjuntor/extintor permanece fora do escopo.

## Alteração e auditoria

Cada mudança exige justificativa de 3 a 1.000 caracteres. A confirmação informa o escopo e os efeitos concretos. O registro de auditoria `FEATURE_CONFIGURATION_CHANGED` guarda autor, horário, escopo/condomínio, recurso, motivo, valores anteriores e novos e versão. Se outra pessoa salvar a mesma configuração antes, o servidor retorna conflito; a tela recarrega o estado e exige uma nova escolha, sem sobrescrever silenciosamente.

Menus, atalhos, cartões e controles acompanham a disponibilidade. A URL direta mostra indisponibilidade e a API bloqueia a operação mesmo que a tela ainda esteja aberta. Mudanças notificam os painéis em tempo real; também há reconciliação ao recuperar foco e a cada 30 segundos. Falhas ao consultar a configuração impedem a exibição dos módulos até uma nova consulta válida.

## O que acontece durante a pausa

| Recurso desativado | Efeito |
|---|---|
| Sensores e medidores | As novas leituras correspondentes são descartadas, sem armazenamento ou recuperação posterior. Em uma mensagem mista, métricas de recursos habilitados continuam sendo processadas. Heartbeat e comunicação dos equipamentos continuam ativos. |
| Monitoramento | Cálculos, regras e novos alertas do recurso ficam suspensos. A disponibilidade é conferida novamente antes de entregar um alerta. |
| Apenas IA | Leituras e limites convencionais dos recursos habilitados continuam ativos; a análise adaptativa e seus alertas ficam suspensos. |
| Portões | Novos pedidos são bloqueados e pedidos ainda pendentes são cancelados. A desativação é coordenada com o despacho: comandos já enviados podem concluir e continuam recebendo confirmação. Não são reenviados na retomada. |
| Vagas | Contagens ficam indisponíveis. Capacidade e configuração são preservadas. |
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
| `GET /features/catalog` | Administrador da plataforma; catálogo e dependências |
| `GET /features/global` | Administrador da plataforma; configuração global |
| `GET /features/buildings/:buildingId` | Usuário autorizado no condomínio ou administrador da plataforma; estado efetivo |
| `PUT /features/global/:key` | Administrador da plataforma; estado global booleano |
| `PUT /features/buildings/:buildingId/:key` | Administrador da plataforma; `true`, `false` ou `null` para herdar |

Exemplo de corpo: `{"enabled":false,"version":0,"reason":"Manutenção do medidor de água"}`. Use a versão devolvida pela consulta, nunca um número fixo na integração. As respostas de configuração incluem estado efetivo, preferência global/local, motivo de bloqueio, versões e data de retomada. Operações bloqueadas retornam HTTP `403` com `details.code = FEATURE_DISABLED`, após autorização. Conflitos retornam `409` com `details.code = FEATURE_VERSION_CONFLICT`.

## Implantação e teste de aceitação

Aplicar a migração aditiva `012-features.sql` pelo procedimento de [DEPLOY](DEPLOY.md), atualizando API e ingestão conjuntamente antes de liberar a central. Não apagar dados, não executar reset e não usar seed de demonstração em produção.

Em um condomínio de homologação: desative um sensor, envie um lote misto, confira descarte seletivo e heartbeat; reative e confirme nova referência do medidor e vagas desconhecidas. Verifique bloqueio por URL/API nos dois portais, histórico preservado e auditoria. Teste portões com controlador de teste, incluindo um pedido pendente e um já enviado. A validação do software não substitui testes dos equipamentos instalados.
