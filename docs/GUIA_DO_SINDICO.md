# Guia resumido do síndico — o que precisa saber para o Prédio ON funcionar

Resumo para quem administra o condomínio no painel do síndico (`https://sindico.SEUDOMINIO`). O detalhe técnico está no [manual de implantação](IMPLANTACAO_CONDOMINIO.md), em [Funcionalidades](FUNCIONALIDADES.md), [Acessos](ACESSOS.md), [Autenticação](AUTENTICACAO.md) e [Gestão transparente](GESTAO_TRANSPARENTE.md).

## 1. A ideia central

O painel só mostra o que alguém configurou e o que os equipamentos realmente enviam. Três coisas precisam existir ao mesmo tempo para cada módulo aparecer funcionando:

1. **O recurso está ligado** pela plataforma para o seu condomínio (você consulta, não altera).
2. **O cadastro está feito** (unidades, moradores, equipamentos, regras).
3. **Há dados chegando** (sensor/gateway) ou alguém os atualizando (vagas, contas, avisos).

Sem dado, o painel mostra "sem informação" ou "desatualizado". Isso é proposital: ausência de leitura nunca é tratada como "tudo normal".

## 2. O que a plataforma faz por você (e o que você não controla)

| Quem | Faz |
|---|---|
| **Administrador da plataforma** | Cria o condomínio e sua conta de síndico, liga/desliga funcionalidades, cadastra gateways e emite credenciais MQTT, libera o adicional de QR do totem, prepara o suporte remoto (AnyDesk). |
| **Instalador / integrador** | Instala sensores e controladores, configura o gateway, calibra e comprova as leituras. |
| **Equipe de tecnologia** | Servidor, domínios/HTTPS, backup e restauração, atualizações. |
| **Síndico (você)** | Pessoas, regras, rotina do condomínio e acompanhamento diário. |

Você **não** liga/desliga funcionalidades. Se um menu não aparece, ele está desligado para o condomínio. **Portões e vagas vêm desligados por padrão** e só devem ser ligados quando o equipamento estiver instalado e testado.

## 3. Primeiros passos (ordem recomendada)

1. **Entrar e proteger a conta.** Em *Minhas sessões*, ativar a verificação em duas etapas (aplicativo autenticador) e guardar os 10 códigos de recuperação. A senha tem no mínimo 15 caracteres. Ações sensíveis (conceder papel de gestão, por exemplo) pedem a senha de novo se o login tiver mais de 10 minutos.
2. **Cadastrar a estrutura** em *Unidades e equipes*: blocos, unidades e equipes (zeladoria, manutenção).
3. **Convidar moradores** em *Unidades e equipes → Moradores e vínculos*: nome, e-mail e unidade. O convite vale **7 dias** e o código/link aparece **uma única vez** — você precisa entregá-lo ao morador por canal privado (WhatsApp, pessoalmente). O morador escolhe a própria senha. Reenviar para o mesmo e-mail cancela o convite anterior.
4. **Dar poderes à equipe** em *Permissões* (manutenção, zelador). Convite só cria morador; papéis de gestão são concedidos por quem tem autoridade para isso.
5. **Conferir a lista de equipamentos** em *Equipamentos* e se os nomes são compreensíveis ("Caixa superior bloco A").
6. **Configurar alertas** em *Regras de alerta* (ver seção 5).
7. **Rotina da comunidade**: avisos, áreas comuns e transparência (seção 6).

## 4. Monitoramento: o que depende de hardware

Água, energia, bomba, gás, fumaça, vazamentos, portões e sensores de vaga **só funcionam com equipamento físico e gateway instalados** pelo integrador. O repositório traz contratos e simuladores, não firmware.

Pontos que o síndico deve entender:

- **Leitura com mais de 15 minutos** ou sem qualidade não prova que está normal.
- **Fumaça/gás** no painel apenas refletem o que a central/detector já detectou. O sistema **não substitui** alarmes e procedimentos locais de incêndio e gás, e não depende só da internet.
- **Caixa d'água** mostra nível e volume; **consumo** exige hidrômetro/medidor próprio (o nível da caixa não mede consumo).
- A bomba é **só monitorada**; não há comando remoto para ligar/desligar.
- Medidor geral mostra *que* o consumo subiu, não *onde* (qual lâmpada, qual cano).

### Decisões que são suas em *Consumo e análise*

- **Tarifa** por kWh e m³ (o custo mostrado é estimativa; mudar a tarifa não recalcula o passado).
- **Limites diários** de consumo/custo e minutos da bomba (por dia e contínuos).
- **Análise de desvios**: precisa de 7 a 28 dias com dados válidos para aprender. Durante o aprendizado, mantenha limites explícitos.
#### Campos do formulário "Configurar tarifas, limites e análise"

Cada medidor tem o seu formulário (água, energia, bomba). Valores abaixo são os do exemplo em uso; ajuste ao seu condomínio.

| Campo | Aparece em | O que significa | Exemplo |
|---|---|---|---|
| Tarifa (R$/m³) ou (R$/kWh) | Água, energia | Preço usado para estimar o custo. Vale só para os próximos intervalos; não recalcula o passado. Em branco, não calcula custo. Não existe na bomba. | 8,6 |
| Limite diário (m³ / kWh) | Água, energia | Gera alerta quando o total do dia ultrapassa o valor. | 45 m³ |
| Limite de custo diário (R$) | Água, energia | Alerta pelo custo estimado do dia. Precisa de tarifa preenchida. | em branco |
| Limite diário (minutos) | Bomba | Tempo total ligada no dia. | 480 |
| Limite contínuo da bomba (minutos) | Bomba | Tempo seguido ligada sem desligar; indica bomba presa ou caixa que não enche. | 120 |
| Intervalo máximo entre leituras (s) | Todos | Acima disso o trecho fica **sem estimativa** (nunca vira consumo zero). Use um valor um pouco acima da frequência real do gateway. | 900 |
| Dias válidos para aprender (7 a 28) | Todos | Quantos dias completos o sistema usa como referência. Dias incompletos não contam. | 7 |
| Desvio mínimo sobre o histórico (%) | Todos | Só alerta se o consumo passar da referência aprendida em pelo menos esse percentual. | 50 |
| Analisar desvios com referência aprendida | Todos | Liga a análise estatística; até completar os dias, valem só os limites explícitos acima. | ligado |
| Monitoramento ativo | Todos | Desligado, o medidor para de ser avaliado. | ligado |

Campos vazios não são aplicados. Limite alto demais esconde problema; baixo demais gera alerta toda hora — acompanhe a primeira semana antes de fixar os valores.

- **Consumo para moradores**: desligado por padrão; só você libera (botão *Liberar para moradores*). O morador vê apenas quantidades diárias, nunca custo nem equipamentos.

## 5. Alertas

- Crie regras com **mensagem que diga o local e a ação** ("Nível baixo — caixa superior bloco A"). Evite mensagens genéricas.
- Alertas aparecem no painel; você ou a equipe precisa **reconhecer e resolver** — leitura que volta ao normal não encerra o alerta sozinha.
- **Aviso por WhatsApp/e-mail não vem pronto.** Exige um integrador externo configurado pela equipe técnica (`ALERT_WEBHOOK_URL`) e só alertas HIGH/CRITICAL são enviados. Combine quem olha o painel quando esse canal falhar.
- Para ordens de serviço automáticas, use *Automações* (só abrem ordem; não acionam equipamentos).

## 6. Rotina da comunidade (tudo manual, feito por você)

| Módulo | O que fazer | Limite a conhecer |
|---|---|---|
| **Avisos** | Título, local, data do evento, quando publicar/encerrar; repetição semanal. | Não envia lembrete por WhatsApp/e-mail; aparece no app/portal. |
| **Áreas comuns** | Cadastrar espaços, aprovar, recusar ou cancelar reservas; conflito de horário é tratado. Em **Regras das áreas**, definir o limite mensal por apartamento de cada espaço (1, 2 etc. ou **Ilimitado**). | Novas áreas começam com 1 reserva por mês por apartamento. Pendentes e confirmadas contam juntas; cancelar ou recusar libera a cota. As configurações de áreas existentes são preservadas. Sem cobrança nem pagamento. |
| **Ocorrências** | Responder, mudar gravidade (com justificativa), agrupar chamados repetidos e concluir. | Não contrata prestador; você define quem encaminha. Morador só vê o próprio chamado. |
| **Transparência e contas** | Publicar andamento de serviços e prestação mensal (receitas, despesas, saldo, links HTTPS de comprovantes). Rascunho é invisível ao morador; correção = nova revisão (a anterior é preservada). | Sem conciliação bancária; o saldo não é transferido automaticamente entre meses. Defina quem confere os valores. |
| **Vagas** | Cadastrar carros e motos separados; atualizar a contagem manualmente ou por sensor. | Dado expira (padrão 5 min, configurável de 30 s a 24 h) e passa a "Desatualizado". Não atribui vaga a veículo. |

## 7. Portões e acessos (só depois de instalados e testados)

- Garagem e pedestre são acessos **separados**; cada um precisa de controlador, ensaio supervisionado e observação física do movimento.
- "Pedido registrado" não é "portão abriu": a confirmação vem do controlador, e a posição real exige olhar ou sensor.
- Há trava de segurança: comando vale **15 s**, intervalo mínimo de 5 s entre pedidos, e nunca é executado depois de uma reconexão.
- A operação local do portão (controle, botoeira) deve continuar funcionando se o app cair.
- **Totem de QR (adicional)**: a plataforma libera no condomínio; você pareia o tablet em *Portões e acessos → Parear tablet* (código válido por 10 minutos), testa, e só então decide exigir o QR dos moradores. O QR muda a cada hora e só o app do morador valida.
- Quem sai do condomínio precisa ter o vínculo **revogado** (não basta trocar senha).

## 8. Antes de dizer "está em produção"

Não considere um módulo operacional só porque o painel abre ou mostra um valor. Exija do instalador as **evidências** da Etapa 12 do manual: leitura do painel versus medição física, ensaio de alerta, portão com ACK e observação, vagas conferidas, backup restaurado e certificados válidos. Dados simulados (usados na demonstração) **não valem** como aceite.

## 9. O que ainda não existe (para não prometer ao condomínio)

- Envio automático de e-mail/WhatsApp (avisos, convites, lembretes) e push no celular.
- Pagamentos, cobrança de taxa de salão, conciliação bancária.
- Comando remoto de bomba; módulo de disjuntor/extintor.
- Garantia de entrega e repetição de alertas externos sem a integração completada.
- Alta disponibilidade e dimensionamento universal do servidor: definidos por instalação.
- Remoção do fator MFA de quem perdeu app e códigos: precisa de atendimento da plataforma.

## 10. Checklist rápido do síndico

- [ ] Conta com senha forte, MFA ativo e códigos de recuperação guardados
- [ ] Blocos, unidades e equipes cadastrados
- [ ] Moradores convidados por canal privado; saídas revogadas
- [ ] Papéis da equipe (zelador, manutenção) concedidos
- [ ] Nomes dos equipamentos claros e leituras conferidas com o instalador
- [ ] Regras de alerta com responsável e substituto definidos
- [ ] Tarifas, limites de consumo e liberação (ou não) do consumo ao morador
- [ ] Rotina mensal: avisos, conferência da prestação de contas, contagem de vagas (se manual)
- [ ] Contatos de suporte e plano de contingência (energia, internet, portão) impressos
- [ ] Evidências de aceite arquivadas

## 11. Quando algo "não funciona"

| Sintoma | Causa provável | Quem resolve |
|---|---|---|
| Menu (Acessos, Vagas, Consumo…) não aparece | Funcionalidade desligada ou sem permissão | Administrador da plataforma / você (permissões) |
| "Sem informação" / "Desatualizado" | Gateway offline, sensor sem leitura ou contagem manual vencida | Instalador / você (vagas manuais) |
| Convite não funciona | Expirou (7 dias), foi substituído ou já usado — a resposta é a mesma em todos os casos | Emitir novo convite |
| Login recusado repetidamente (429) | Limite de tentativas; aguardar o tempo informado | — |
| Alerta não chegou no WhatsApp | Webhook não configurado ou provedor fora | Equipe técnica |
| Portão não abriu | Recurso desligado, controlador offline, comando vencido ou permissão ausente | Integrador / síndico |
