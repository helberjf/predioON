# Manual de implantação e operação do Prédio ON em condomínio

Versão 3 em Markdown de 24 de setembro de 2026 com suporte remoto, gestão transparente e controle de funcionalidades

Este manual orienta o síndico, o instalador e a equipe de tecnologia desde a vistoria até a operação diária. Comece pelos 10 passos abaixo. Em caso de dúvida, use o resumo seguinte para encontrar a explicação detalhada de cada etapa.

## Resumo rápido para WhatsApp

1. Vistoriar o condomínio e definir responsáveis.
2. Escolher e comprar sensores e controladores.
3. Preparar servidor, internet e energia.
4. Cadastrar pessoas e liberar funcionalidades do condomínio.
5. Instalar e configurar os equipamentos.
6. Ajustar medições de água, energia, bomba e alertas.
7. Configurar portões, vagas, avisos, reservas, chamados e contas.
8. Preparar suporte remoto, alertas e cópias de segurança.
9. Testar tudo no condomínio e corrigir pendências.
10. Treinar a equipe, liberar o uso e acompanhar a manutenção.

## Resumo do passo a passo

1. **Vistoriar e definir responsáveis.** Listar os locais, equipamentos e quem cuida de cada parte. Consultar Etapa 1.
2. **Escolher os equipamentos.** Confirmar compatibilidade dos sensores e controladores. Consultar Etapa 2.
3. **Preparar a infraestrutura.** Providenciar internet, energia, servidor e endereços do sistema. Consultar Etapa 3 e Anexo A.
4. **Cadastrar e liberar os recursos.** Criar condomínio, administrador, síndico e moradores; conferir permissões e funcionalidades habilitadas. Consultar Etapa 4, Anexo B e [Controle de funcionalidades](FUNCIONALIDADES.md).
5. **Conectar os equipamentos.** Configurar o gateway e identificar cada sensor no sistema. Consultar Etapa 5.
6. **Conferir as leituras reais.** Comparar os valores do aplicativo com as medições no local. Consultar Etapa 6.
7. **Configurar os alertas.** Ajustar limites, tarifas, tempo de bomba e aprendizado do consumo. Consultar Etapa 7.
8. **Testar os dois portões.** Conferir garagem, pedestre, permissões e retorno após falha. Consultar Etapa 8.
9. **Organizar a rotina.** Configurar avisos, salão, chamados, transparência, contas e vagas separadas de carros e motos. Consultar Etapa 9.
10. **Preparar atendimento e recuperação.** Configurar AnyDesk e testar mensagens, backup e restauração. Consultar Etapas 10 e 11 e Anexo C.
11. **Aprovar os testes de campo.** Corrigir as pendências e guardar as evidências. Consultar Etapa 12.
12. **Treinar e acompanhar.** Orientar a equipe, liberar os moradores e manter a rotina de manutenção. Consultar Etapas 13 e 14.

**Critério de conclusão:** considerar o escopo contratado integralmente operacional somente após a aprovação da Etapa 12. Ter o aplicativo aberto ou ver uma leitura simulada não comprova a instalação. A análise histórica precisa completar o aprendizado com dados reais para ser aceita como operacional. Nenhum sistema oferece disponibilidade absoluta; o condomínio precisa manter os procedimentos locais para falhas de energia, internet e equipamentos.

**Situação do software em 24/09/2026:** implementação local com sensores e controladores simulados, integração AnyDesk, chamados ampliados, prestação de contas e controle de funcionalidades global/por condomínio. As evidências atualizadas estão em [Revisão de funcionalidades](REVISAO_FUNCIONALIDADES.md). Este manual não registra uma instalação física já realizada. O módulo de disjuntor/extintor foi excluído a pedido do responsável pelo projeto. Esta revisão em Markdown é a referência atualizada; a versão 1 em Word não contém os complementos posteriores.

## Etapa 1 Levantamento do condomínio e responsáveis

**Responsáveis:** síndico e instalador, com participação da equipe de tecnologia. **Resultado:** ficha de implantação preenchida antes da compra e da instalação.

1. Registrar nome, endereço, quantidade de blocos, unidades e contatos do condomínio. Definir o fuso horário correto; no exemplo brasileiro deste projeto, America/Sao_Paulo.
2. Desenhar um mapa simples dos reservatórios, bombas, quadros elétricos, medidores, central de incêndio, pontos de gás, locais de vazamento, portões e estacionamentos.
3. Contar os pontos reais. Duas caixas ou duas bombas precisam de identificação e acompanhamento próprios. Não presumir que um único sensor representa todo o prédio.
4. Para cada ponto, registrar localização, fabricante, modelo, número de série, sinal disponível, distância até o gateway, alimentação e condições de instalação.
5. Definir quais consumos serão medidos: áreas comuns, entrada geral ou circuito específico. Para investigar uma luminária, um medidor geral pode mostrar o aumento, mas não identifica sozinho a luminária defeituosa. A localização exige investigação elétrica ou medição adicional por circuito.
6. Definir quem administra usuários, quem atende alertas, quem faz manutenção e quem pode autorizar abertura remota. Registrar contatos principal e substituto, inclusive fora do horário comercial.
7. Definir metas de operação: intervalo esperado de leitura, prazo para atendimento de alertas, tempo aceitável de indisponibilidade e perda máxima aceitável de histórico em uma recuperação.

| Papel | Entrega esperada | Nome e contato |
|---|---|---|
| Síndico ou gestor | Aprovar locais, regras, usuários e recebimento da instalação | Preencher |
| Instalador de campo | Instalar, identificar, calibrar e testar os pontos físicos | Preencher |
| Integrador do gateway | Implementar leitura, comunicação e contrato dos portões | Preencher |
| Responsável pela hospedagem | Servidor, domínio, certificados, backup e atualizações | Preencher |
| Responsável pelos alertas | Receber, verificar, atender e encerrar ocorrências | Preencher |

**Conferência:** todos os pontos têm um responsável e um nome compreensível, como “Caixa superior bloco A” ou “Portão pedestre rua principal”.

## Etapa 2 Equipamentos e compatibilidade

**Responsáveis:** instalador e integrador. **Resultado:** lista de materiais dimensionada para os pontos levantados, acompanhada dos manuais dos fabricantes.

| Função | Equipamento ou sinal necessário | O que conferir antes de comprar |
|---|---|---|
| Nível e volume de água | Sensor de nível adequado ao reservatório | Faixa, instalação, geometria e cálculo do volume |
| Consumo de água | Hidrômetro com leitura acumulada, pulsos ou interface compatível | Conversão de pulsos e acumulador em m³ |
| Energia e fases | Medidor compatível com a instalação elétrica | Tensão, corrente, frequência e acumulador em kWh conforme o escopo |
| Bomba | Contato auxiliar ou monitor apropriado | O sinal representa comando, energização ou funcionamento medido |
| Vazamento de água | Sonda ou cabo sensor compatível | Cobertura dos pontos e resistência ao ambiente |
| Vazamento de esgoto | Sensor apropriado ao local e ao fluido | Manutenção, corrosão e identificação separada da água |
| Gás | Detector adequado ao gás e à aplicação | Tipo de gás, saída disponível, calibração e manutenção |
| Fumaça ou incêndio | Saída de alarme da central existente | Interface autorizada pelo fabricante e pelo responsável técnico |
| Temperatura | Sensor adequado à sala ou equipamento | Faixa e precisão necessárias |
| Garagem e pedestre | Controlador integrado à central do portão | Entrada de comando compatível e protocolo completo da Etapa 8 |
| Vagas de carros e motos | Contador/sensor ou rotina de contagem manual | Contagens independentes e reconciliação com a ocupação real |
| Comunicação | Gateway programável e conexão de rede | Leitura local, TLS, credenciais, relógio e recuperação após queda |

Um conversor serial simples não necessariamente executa as funções do gateway. O integrador deve demonstrar a leitura dos sensores, a conversão das unidades e a publicação no protocolo do Prédio ON. Cadastrar um endereço Modbus no sistema não instala o programa no equipamento. O repositório contém contratos e simuladores; a integração física depende do firmware ou software do integrador.

Dimensionar também fontes, caixas de proteção, cabos, interfaces isoladas e alimentação de reserva conforme o projeto. A instalação elétrica deve ser executada por profissional autorizado, com os controles aplicáveis à atividade; o responsável técnico deve consultar a [NR 10 do Ministério do Trabalho e Emprego](https://www.gov.br/trabalho-e-emprego/pt-br/acesso-a-informacao/participacao-social/conselhos-e-orgaos-colegiados/comissao-tripartite-partitaria-permanente/normas-regulamentadora/normas-regulamentadoras-vigentes/norma-regulamentadora-no-10-nr-10). Este manual trata da integração do sistema e não substitui o projeto elétrico ou os manuais dos equipamentos.

**Conferência:** cada item da lista de materiais corresponde a um ponto da vistoria e tem interface documentada. Quantidades, modelos, custos e limites de segurança devem ser definidos para o condomínio real.

## Etapa 3 Internet energia e hospedagem

**Responsáveis:** equipe de tecnologia e instalador. **Resultado:** plataforma permanente, conectividade medida nos locais de instalação e certificados válidos.

1. Escolher uma hospedagem que mantenha banco, comunicação e aplicação em funcionamento contínuo. A configuração do projeto usa um servidor Linux com Docker Compose. O computador de demonstração com o Docker Desktop não é uma instalação permanente já homologada.
2. Dimensionar CPU, memória, disco e retenção a partir da quantidade de sensores e frequência das leituras. Registrar consumo de recursos no piloto e rever antes de ampliar. O projeto não tem um dimensionamento universal nem alta disponibilidade configurada.
3. Preparar internet no condomínio e verificar o sinal exatamente onde ficarão os gateways. Definir contingência de conexão e autonomia de energia conforme a criticidade local.
4. Manter o relógio do servidor e dos gateways sincronizado. Datas incorretas afetam histórico, validade das vagas e comandos dos portões.
5. Criar os endereços públicos de administração, síndico, morador, API e MQTT. Preencher os valores reais no Anexo A.
6. Publicar os painéis por HTTPS e conectar gateways externos por MQTT com TLS na porta 8883. Banco, MQTT interno e painel administrativo do broker devem permanecer fora da exposição pública direta.
7. Conferir a licença do EMQX antes de contratar ou comercializar a hospedagem. O projeto fixa a versão 6.3.1; a licença do fornecedor impõe condições para serviço hospedado ou incorporado oferecido a terceiros. Validar o enquadramento com o fornecedor conforme a [FAQ oficial de licenciamento](https://www.emqx.com/en/content/license-faq).
8. Executar o Anexo A e registrar versão do código, imagens utilizadas, domínios e responsável pelos certificados.

**Conferência:** os três painéis abrem de uma rede externa com certificado válido; a API responde; uma leitura de teste atravessa a conexão TLS. A resposta de saúde da API verifica o banco, mas não comprova sozinha o funcionamento de sensores, broker ou envio de mensagens.

## Etapa 4 Cadastro do condomínio, usuários e funcionalidades

**Responsável:** administrador da plataforma. **Resultado:** cadastros reais e permissões conferidas.

1. Em banco novo, criar a primeira conta administrativa pelo procedimento técnico do Anexo B. Não executar o seed de demonstração para cadastrar o condomínio real.
2. Entrar em `https://admin.SEUDOMINIO` com a conta criada.
3. Em Clientes, cadastrar a organização responsável. Em Prédios, cadastrar o condomínio e associá-lo ao cliente correto. Informar nome, código, tipo Condomínio e fuso horário.
4. Em Usuários, cadastrar o síndico/zelador com o papel correspondente e vínculo ao prédio. Cadastrar moradores com o papel Morador e a unidade correta. Usar uma conta individual para cada pessoa.
5. Entregar o acesso por canal privado. Não colocar senhas no manual, em avisos ou em grupos do condomínio. O formulário permite senha provisória, mas a versão atual não oferece um fluxo completo de recuperação/troca autônoma; combinar esse atendimento com o suporte técnico.
6. Testar o síndico em `https://sindico.SEUDOMINIO` e o morador em `https://morador.SEUDOMINIO`. O morador não deve conseguir alterar parâmetros, contagens ou cadastros administrativos.
7. Definir o processo de admissão e saída de moradores. O suporte deve revogar o vínculo de quem saiu; a API oferece `DELETE /users/memberships/:membershipId`. Esse procedimento não deve depender de uma pessoa continuar guardando a senha antiga.
8. No painel administrativo, abrir **Funcionalidades**. Conferir primeiro o escopo Global e depois selecionar o condomínio em **Onde aplicar**. Os 23 controles começam ativos/herdados; ajustar ao escopo da instalação.
9. Para cada recurso, selecionar **Herdar global**, **Ativar** ou **Desativar**, informar justificativa e confirmar os efeitos. O bloqueio global prevalece; apenas administradores ativos da plataforma alteram esses controles. Síndicos e moradores consultam a disponibilidade.
10. Conferir menus e URLs diretas nos dois portais. Ativar uma funcionalidade não habilita um portão ou equipamento cujo cadastro esteja desativado. Manter o cadastro físico coerente com a instalação.

### Pausar e retomar recursos durante manutenção

1. Escolher o condomínio correto em **Funcionalidades** e registrar o motivo da pausa. A alteração fica na auditoria com autor, horário, estado anterior/novo e versão.
2. Ler a confirmação: sensores pausados têm novas leituras descartadas; análises e novos alertas correspondentes param. Histórico anterior, reservas e chamados permanecem armazenados. Heartbeat dos gateways continua funcionando.
3. Para portões, pedidos pendentes são cancelados; comandos já enviados ainda podem executar e receber confirmação. Para suporte remoto, uma sessão AnyDesk externa já aberta continua independente do controle.
4. Ao reativar, aguardar novas amostras válidas. Medidores iniciam uma nova referência sem contabilizar o intervalo pausado como consumo. Dias incompletos não entram no aprendizado. Vagas ficam desconhecidas até uma atualização válida.
5. Conferir leituras, estado efetivo e histórico nos portais. Se houver conflito de edição, conferir a configuração mais recente antes de tentar novamente.

O controle é de software e não desliga fisicamente sensores, bombas ou outros equipamentos. O procedimento completo, catálogo e dependências estão em [Controle de funcionalidades](FUNCIONALIDADES.md).

Contas de demonstração e o prédio “Condomínio Piloto” pertencem ao laboratório. Uma instalação real deve usar um banco próprio ou uma separação de ambiente que impeça confusão com os testes. Não executar scripts de reset em dados reais.

**Conferência:** um usuário de teste sem vínculo não acessa o condomínio; um morador autorizado consulta os dados previstos e não consegue administrar o sistema.

## Etapa 5 Gateway e cadastro dos sensores

**Responsáveis:** administrador e integrador. **Resultado:** cada mensagem está associada ao condomínio e equipamento corretos.

1. No painel administrador, cadastrar o gateway com prédio, nome, número de série e modelo. Copiar o ID gerado pelo sistema para a ficha de instalação.
2. Usar Gerar credencial no gateway. Guardar a senha exibida em local seguro e configurá-la no equipamento; ela não pode ser recuperada em texto depois. O usuário MQTT e o identificador de conexão são fornecidos na emissão.
3. Configurar o endereço `mqtts://mqtt.SEUDOMINIO:8883`, validação do certificado, usuário e senha. O `clientId` deve ser o ID do gateway. Dois equipamentos não podem usar simultaneamente o mesmo identificador de conexão.
4. Em Dispositivos, selecionar o gateway e cadastrar um registro por ponto. Informar nome, tipo e endereço de campo. Copiar o ID gerado, em vez de presumir IDs usados nos exemplos.
5. O integrador deve configurar no gateway os endereços, registradores, escalas, ordem de bytes e entradas de cada equipamento conforme o fabricante. Manter uma cópia dessa configuração. Informações avançadas de `metadata` e cadastro de métricas podem exigir a API; o formulário básico não configura esses dados automaticamente.
6. Publicar uma leitura válida por equipamento. Conferir valor, unidade, qualidade e horário. Somente marcar `GOOD` quando a aquisição tiver sido válida; não substituir falha de leitura por zero.
7. Publicar status ONLINE periodicamente e configurar Last Will OFFLINE com retenção e QoS 1. Definir a periodicidade de status/telemetria abaixo dos limites de ausência usados na instalação.
8. Implementar buffer local para telemetria se houver exigência de recuperação de histórico. Ao reenviar a mesma amostra, conservar `eventId` e horário original. A fila de telemetria não pode virar fila de abertura de portão.

### Identificação mínima da mensagem

O tópico genérico é `predio/{buildingId}/device/{deviceId}/telemetry`. O corpo deve ter o mesmo prédio e dispositivo do tópico. Este exemplo ilustra uma amostra; os IDs e a data precisam ser substituídos pelos valores reais.

```json
{
  "schemaVersion": 1,
  "eventId": "identificador-unico-desta-amostra",
  "buildingId": "ID_REAL_DO_PREDIO",
  "deviceId": "ID_REAL_DO_SENSOR",
  "metric": "water_level_percent",
  "value": 72,
  "unit": "%",
  "quality": "GOOD",
  "timestamp": "2026-09-23T12:00:00.000Z"
}
```

O horário é o da coleta em UTC. Booleanos devem ser `true` ou `false`, sem aspas. O contrato completo de nível também aceita o tópico específico de caixa d'água descrito em `docs/HARDWARE_SOFTWARE.md`.

**Conferência:** o painel exibe nome, leitura e horário corretos de todos os pontos. Reiniciar um gateway de teste não duplica a mesma amostra. A credencial de um gateway não publica em equipamento de outro condomínio.

## Etapa 6 Instalação e conferência de cada função

**Responsável:** instalador com o integrador. **Resultado:** ficha de calibração e evidência de leitura real por ponto. Os testes devem seguir o método do fabricante; não provocar curto, fuga elétrica, liberação de gás, incêndio ou transbordamento para testar o aplicativo.

### Água no reservatório

1. Registrar dimensões, formato, capacidade útil e referência de instalação do sensor.
2. Confirmar nível por medição independente em pelo menos dois pontos conhecidos, quando praticável. Definir a tolerância aceitável conforme equipamento e projeto.
3. Conferir percentual e litros separadamente. O volume depende da geometria; uma caixa não uniforme não permite conversão linear automática sem curva apropriada.
4. Configurar o gateway para publicar `water_level_percent` e, quando calculados/medidos, `volume_liters` e `distance_mm`.
5. Conferir a tela Água, o histórico e uma regra de nível baixo em ensaio controlado. Voltar aos limites reais ao terminar.

### Consumo de água e energia

1. Instalar o medidor no trecho ou circuito aprovado. Registrar a leitura acumulada inicial e seu horário.
2. Confirmar escalas, relação de transformação quando houver e persistência do acumulador após reinício do gateway.
3. Publicar `water_total_m3` e `energy_total_kwh`. Enviar o acumulado, não o consumo já calculado do dia.
4. Comparar a diferença entre duas leituras físicas com o total correspondente no sistema. O nível da caixa não substitui um hidrômetro de consumo.

### Falta de fase e parâmetros elétricos

1. Identificar cada fase no projeto e no medidor. Conferir os valores com instrumento apropriado pelo profissional responsável.
2. Publicar `voltage_l1`, `voltage_l2` e `voltage_l3`; adicionar correntes e frequência se o equipamento fornecer esses dados.
3. Definir limites adequados à tensão e às cargas do condomínio. Os valores de demonstração não são parâmetros universais.
4. Ensaiar o alerta por recurso de teste do equipamento ou sinal simulado em ambiente isolado. Preservar as proteções físicas existentes.

### Bomba

1. Identificar qual bomba o sinal representa. Confirmar se o contato indica acionamento do contator ou se há medição independente de funcionamento.
2. Publicar `pump_running` como booleano e manter amostras periódicas mesmo sem mudança de estado. Somente enviar transições deixa lacunas no cálculo de duração.
3. Observar um ciclo normal e comparar início, parada e minutos no sistema. Contato energizado não comprova por si só vazão de água.
4. Configurar duração diária e contínua na Etapa 7. O escopo implementado monitora a bomba; não oferece comando remoto para ligá-la ou desligá-la.

### Vazamento de água e de esgoto

1. Identificar cada ponto e o tipo de fluido monitorado. Usar cadastros separados.
2. Conferir a polaridade e a lógica da entrada com o fabricante. Publicar `water_leak_detected` ou `sewage_leak_detected`.
3. Executar o teste de detecção autorizado pelo fabricante, confirmar alerta e retornar ao estado normal.
4. Confirmar que falta de comunicação aparece como ausência de informação, e não como local seco. Para equipamentos antigos que usam `leak_detected`, não duplicar a amostra com a métrica nova.

### Gás fumaça e temperatura

1. O responsável pelo sistema local deve definir detector adequado ao gás, localização, manutenção e critérios de teste. Publicar `gas_detected`; `gas_ppm` é adicional quando suportado.
2. Integrar o sinal da central de incêndio existente como `smoke_detected`. Esse booleano informa o alarme da central, não concentração de fumaça.
3. Conferir a temperatura real e a unidade °C antes de configurar a regra.
4. Realizar os ensaios com procedimento e acessórios previstos pelos fabricantes e equipe habilitada, coordenando qualquer alarme de teste com a operação do condomínio.
5. Manter detectores, central, sirenes e procedimentos locais independentes da internet. O aplicativo acompanha os sinais e não substitui o sistema de segurança do imóvel.

**Conferência:** uma leitura `false` significa ausência de detecção naquela amostra. No painel de sensores, leitura com mais de 15 minutos, inválida ou sem qualidade não comprova condição normal. O limite visual de 15 minutos não deve ser usado como prazo de resposta a uma emergência.

## Etapa 7 Parâmetros consumo e análise histórica

**Responsáveis:** síndico e integrador, com limites técnicos aprovados pelo responsável por cada equipamento. **Resultado:** regras configuradas e exemplos de alerta verificados.

### Regras dos sensores

1. Em Regras de alerta, escolher nome, equipamento, métrica, condição e limite.
2. Para detecções booleanas, configurar igualdade a 1 quando a intenção for alertar sobre `true`.
3. Definir gravidade e mensagem que identifique o local e a ação esperada. Evitar mensagens genéricas como “deu problema”.
4. Definir intervalo entre repetições. Esse intervalo reduz mensagens repetidas; ele não exige que a condição permaneça ativa durante esse tempo.
5. Testar uma condição fora do limite e a volta à normalidade. Confirmar o tratamento do alerta pelo operador; uma leitura normal não substitui o encerramento operacional de um alerta aberto.

### Consumo e duração da bomba

1. Abrir Consumo e análise como gestor e associar cada medidor ao tipo correto: energia, água ou bomba.
2. Informar tarifa por kWh e, se aplicável, por m³. Registrar a data e a origem da tarifa escolhida. A conta pode conter cobranças que não entram nessa estimativa.
3. Definir limites diários de quantidade e/ou custo. Para bomba, definir minutos por dia e minutos contínuos. Não cadastrar tarifa na bomba.
4. Definir o intervalo máximo entre amostras de acordo com a frequência efetiva do equipamento. Intervalos maiores ficam sem cálculo; não devem ser interpretados como consumo zero.
5. Conferir total do dia, cobertura e última leitura. Uma queda de acumulador é tratada como reinício/troca do medidor e pode deixar o intervalo sem cálculo.
6. Ao mudar tarifa, registrar a alteração: ela vale para os próximos intervalos e não recalcula os custos históricos.

### Exemplos de configuração

| Situação | Configuração ilustrativa | Verificação esperada |
|---|---|---|
| Energia passa de R$ 10 para R$ 50 por dia | Referência válida de R$ 10 e tarifa de ensaio de R$ 1/kWh | 50 kWh representam R$ 50 estimados e aumento de 400% |
| Desejo de aviso antes de chegar a R$ 50 | Limite diário ilustrativo de R$ 20 | Alerta ao ultrapassar o limite; ajustar ao condomínio |
| Bomba costuma funcionar 60 minutos por dia | Limite diário ilustrativo de 90 minutos | Um dia com 120 minutos ultrapassa o limite |
| Água aumenta fora do padrão | Hidrômetro real, limite aprovado e histórico de dias válidos | Alerta de desvio, sem afirmar a localização de um vazamento |

Esses valores servem para demonstrar a configuração. Não são limites técnicos de segurança nem recomendações universais de consumo. Limites diários são avaliados quando o total os supera; não existe previsão automática da conta mensal. Cada tipo de alerta analítico é emitido no máximo uma vez por equipamento e dia.

### Aprendizado da análise histórica

Ativar a análise e escolher entre 7 e 28 dias válidos para a referência. O sistema usa os últimos 28 dias anteriores, com ao menos 80% de cobertura diária e sem resets. Enquanto não houver dias suficientes, o estado será de aprendizado. Fins de semana, manutenção e ocupação atípica precisam ser considerados na avaliação do gestor.

A análise aprende uma referência estatística e sinaliza aumentos; não identifica automaticamente a peça defeituosa. Ela compara o acumulado parcial de hoje com a referência diária completa e não projeta o fechamento do dia. Manter limites explícitos durante o aprendizado e confirmar a aceitação da análise somente quando os dados válidos necessários estiverem disponíveis.

**Conferência:** conferir manualmente um período medido e reproduzir os alertas em ambiente de teste, sem adulterar o histórico real para forçar aprendizado.

## Etapa 8 Portão da garagem e entrada de pedestres

**Responsáveis:** integrador do controlador, mantenedor do portão e síndico. **Resultado:** cada acesso comissionado individualmente e permissões aprovadas.

1. Confirmar que o equipamento pode receber o comando de abertura sem alterar as proteções, sensores de obstáculo, fechamento e liberação manual previstos pelo fabricante.
2. Cadastrar gateway, dispositivo do tipo `GATE_CONTROLLER` e acesso em Portões e acessos. Selecionar Garagem ou Pedestre e o controlador correspondente. Manter desativado durante a instalação.
3. Configurar os tópicos exatos de comando e resposta, usando os IDs gerados. O protocolo completo está em `docs/ACESSOS.md`.
4. O firmware deve usar sessão limpa, comando sem retenção, QoS 0, relógio sincronizado e verificação do prazo máximo de 15 segundos. Deve rejeitar comando retido, vencido ou emitido antes da conexão atual, deduplicar `commandId` e nunca enfileirar acionamentos para executar ao reconectar.
5. Publicar presença do gateway e telemetria do próprio controlador em intervalos inferiores a 60 segundos, inclusive quando o portão não for usado. Status do gateway sozinho não atualiza a presença de todos os controladores. O integrador pode usar uma métrica de presença compatível com o contrato genérico, como `controller_online: true`.
6. Após conferir o hardware, habilitar o acesso para ensaio supervisionado. Solicitar uma abertura como gestor e observar o movimento físico do acesso correto.
7. Conferir resultado no aplicativo e registro de auditoria. Resposta HTTP 202 significa pedido registrado; ACK válido significa execução informada pelo controlador. Confirmar a posição física requer observação ou sensor de posição apropriado, não apenas o ACK.
8. Repetir o mesmo pedido de teste com a mesma chave e verificar que não há segundo acionamento. Testar ausência de confirmação, perda da conexão, reinício e retorno da rede sem execução tardia.
9. Ensaiar separadamente a garagem e a entrada de pedestres. Validar que um pedido nunca aciona a outra saída.
10. Somente depois habilitar a permissão de moradores, se aprovada. Testar usuário autorizado e vínculo revogado. A operação local do portão deve continuar disponível durante indisponibilidade do aplicativo.

Existe intervalo mínimo de cinco segundos entre pedidos por acesso e bloqueio enquanto há pedido pendente dentro do prazo. Em caso de resultado incerto, o operador deve verificar o local antes de iniciar novo pedido.

**Conferência:** guardar o identificador do pedido, horário, resultado exibido e observação física. Um simulador respondendo EXECUTED não é aceite de portão real.

## Etapa 9 Avisos reservas serviços e vagas

**Responsáveis:** síndico e equipe de atendimento. **Resultado:** rotina configurada e testada com um morador de ensaio.

### Coleta de lixo reunião e limpeza do hall

1. Abrir Avisos e escolher a categoria adequada.
2. Escrever título, instruções, local e horário. Selecionar fuso e data do evento.
3. Definir quando publicar e quando encerrar. Publicação e horário do evento são campos distintos.
4. Para coleta ou limpeza recorrente, selecionar repetição semanal quando aplicável. A versão atual oferece evento único ou semanal.
5. Entrar como morador e confirmar que o aviso aparece no período correto. Conferir que aviso futuro ou encerrado não fica disponível indevidamente.

A agenda organiza a exibição no aplicativo. Não envia automaticamente lembretes de coleta ou reunião por WhatsApp/e-mail.

### Salão e outras áreas comuns

1. Cadastrar a área, capacidade e regras de uso disponíveis no módulo.
2. Fazer uma reserva pelo perfil do morador, conferir período e aprovar/recusar conforme a política definida.
3. Tentar reservar o mesmo horário com outro morador e verificar o tratamento de conflito.
4. Testar cancelamento e nova disponibilidade. Não presumir cobrança financeira ou integração com pagamentos: isso não faz parte desta entrega.

### Serviços a fazer

1. Abrir um chamado de teste pelo morador e outro pelo síndico, com local, descrição e gravidade baixa, média ou alta.
2. Confirmar o protocolo e a visualização pela gestão. Em Ver histórico e responder, testar respostas dos dois perfis.
3. Alterar a gravidade pelo síndico, informar a justificativa e confirmar que ela aparece para o solicitante.
4. Criar três chamados com categoria, assunto e local iguais. Conferir a sugestão, confirmar o agrupamento e enviar uma resposta comum. Relatos com textos diferentes podem ser selecionados manualmente.
5. Registrar a solução e concluir o grupo. Conferir os encerrados na opção Todos, incluindo encerrados.
6. Verificar com dois moradores que cada um vê apenas seu próprio chamado. Definir quem encaminha o serviço ao prestador; o aplicativo não contrata ou despacha prestador automaticamente.

### Transparência e prestação de contas

1. Abrir Transparência e contas no painel do síndico. Publicar uma atualização com andamento de um serviço, responsável, prazo e próximos passos.
2. Confirmar a leitura no portal do morador e nos avisos. Informações particulares de chamados não devem ser copiadas sem necessidade para a atualização pública.
3. Preparar uma prestação com mês, saldo inicial, receitas, despesas, resumo e links HTTPS de comprovantes. Conferir que os lançamentos pertencem ao mês informado.
4. Salvar rascunho e conferir que moradores ainda não o veem. Validar os totais em centavos e testar os links com a permissão de um morador.
5. Publicar para os moradores. Conferir data, saldo e lançamentos no portal deles.
6. Testar uma correção por nova revisão do mês. A publicação anterior deve continuar preservada. Rascunhos não substituem a revisão publicada vigente.
7. Definir a rotina mensal e o responsável por conferir os valores. Este módulo não realiza conciliação bancária, pagamentos nem transferência automática do saldo entre meses.

Passo a passo completo em [Gestão transparente](GESTAO_TRANSPARENTE.md).

### Vagas disponíveis de carros e motos

1. Contar a capacidade operacional e cadastrar Carros e Motos separadamente. Definir como vagas bloqueadas ou indisponíveis serão tratadas pela gestão.
2. Escolher atualização manual ou sensor. Na contagem automática, vincular um dispositivo `PARKING_SENSOR` a cada categoria; o mesmo sensor não pode alimentar as duas contagens.
3. O sensor deve informar `parking_occupied` como total inteiro de vagas ocupadas, entre zero e a capacidade. Se o equipamento só conta entradas/saídas, o integrador precisa manter e reconciliar o total; o sistema não transforma automaticamente pulsos em ocupação confiável.
4. Informar a ocupação inicial real. Exemplo: 20 vagas de carros e 12 ocupadas devem mostrar 8 livres.
5. Ajustar a validade da informação à operação. O padrão é 300 segundos, configurável entre 30 segundos e 24 horas. Em operação manual, definir quem renova a contagem e com qual frequência.
6. Testar alteração, leitura antiga e falta de dados. Depois do prazo, o sistema deve mostrar Desatualizado ou Sem informação, sem apresentar o número anterior como disponibilidade atual.
7. Conferir a tela do morador, que é de consulta. Ao trocar o sensor, fazer nova leitura ou contagem manual, pois a ocupação anterior deixa de ser referência atual.

**Conferência:** executar os fluxos acima e registrar aprovação. Disponibilidade agregada não representa atribuição de uma vaga individual a um veículo.

## Etapa 10 Alertas recebimento e atendimento

### Preparar suporte remoto

1. Instalar e configurar o AnyDesk no computador do condomínio e do técnico. Manter o computador local ligado, com internet, sem suspensão e com acesso aos programas dos equipamentos.
2. Configurar acesso autorizado no AnyDesk e guardar as credenciais no cofre da equipe. Confirmar a licença para uso profissional.
3. No painel Administrador, abrir Suporte remoto, selecionar o condomínio, cadastrar nome e ID numérico e habilitar.
4. Registrar um atendimento, abrir o AnyDesk, autenticar e testar de outra rede. Reiniciar o computador local e testar novamente.
5. Encerrar a sessão no AnyDesk e registrar resultado e relato no Prédio ON. O aplicativo não confirma automaticamente uma conexão nem encerra a sessão externa.
6. Testar revogação no AnyDesk. Desabilitar no Prédio ON bloqueia novas preparações, mas não remove credenciais já conhecidas.

Guia completo em [Suporte remoto](SUPORTE_REMOTO.md). O heartbeat independente de 60 segundos depende de implementação e homologação no gateway conforme o plano específico; a integração AnyDesk não implementa essa cadência.

### Alertas e responsáveis

**Responsáveis:** síndico, suporte e responsável pelo canal de mensagens. **Resultado:** alerta testado desde o sensor até quem deve atendê-lo.

1. Definir uma lista de responsáveis por assunto: água, energia, portões e sistemas de segurança. Registrar substitutos e prazo de atendimento.
2. Conferir os alertas no painel e ensinar o operador a reconhecer, investigar e resolver cada ocorrência. Registrar providência e evidência no processo de atendimento do condomínio.
3. Se houver necessidade de WhatsApp ou e-mail, contratar/configurar um integrador que receba HTTP POST e faça o envio. Preencher `ALERT_WEBHOOK_URL` no ambiente de produção e recriar o serviço de ingestão para aplicar a configuração.
4. O payload inclui `alertId`, `buildingId`, `deviceId`, gravidade, tipo, mensagem e horário. Configurar destino e controle de duplicatas por `alertId` no integrador.
5. Testar um alerta HIGH ou CRITICAL em ponto de ensaio. Conferir recebimento no integrador, entrega ao destinatário e o conteúdo da mensagem. Os demais níveis permanecem no painel/log.
6. Testar o que ocorre quando o provedor está indisponível. A implementação atual faz uma tentativa com limite de cinco segundos; não possui fila persistente de reenvio nem verificação completa do resultado HTTP/da entrega ao destinatário. Se entrega garantida e repetição forem requisitos do condomínio, essa integração precisa ser completada e homologada antes do aceite desse canal.
7. Definir quem acompanha o painel quando o canal externo falhar. Alarme local de incêndio/gás e a atuação da equipe não podem depender exclusivamente de uma mensagem de internet.

**Conferência:** nenhuma funcionalidade deve ser entregue como “envia WhatsApp” apenas porque o campo do webhook foi preenchido. É necessária evidência de recebimento real e procedimento de contingência.

## Etapa 11 Backup disponibilidade e atualização

**Responsável:** equipe de tecnologia. **Resultado:** recuperação comprovada e rotina com dono definido.

1. Definir frequência de backup, retenção, local externo protegido e prazo máximo aceitável para recuperação. Documentar os valores aprovados; uma cópia diária pode perder as alterações posteriores à última execução.
2. Automatizar a cópia do banco e verificar sucesso, tamanho e checksum. Guardar também versão do código, versões exatas das imagens, configuração do gateway, configuração do servidor e segredos em cofre separado.
3. Copiar os backups para fora do servidor que executa o sistema. Manter o destino com acesso restrito e proteção adequada aos dados.
4. Restaurar em ambiente isolado seguindo o Anexo C. Conferir usuários, cadastros, histórico e leitura da API. Não conectar a cópia restaurada aos controladores reais ou aos canais reais de mensagens.
5. Monitorar API, ingestão, conexão do broker, sensores sem leitura, espaço em disco, execução dos backups e validade dos certificados. Um painel que abre pode estar mostrando dados antigos.
6. Configurar a renovação e recarga dos certificados web e MQTT. O Caddy cuida dos serviços web na configuração prevista; o certificado MQTT tem processo próprio que precisa ser implementado e testado.
7. Antes de atualizar, registrar versão, fazer backup e testar a nova versão em homologação. O script atual usa `drizzle-kit push --force`; não o reaplicar sem revisar os efeitos do schema sobre o banco existente. Preparar janela e plano de retorno quando a alteração exigir.
8. Fazer limpeza/retenção de histórico somente após política aprovada e ensaio. As políticas de retenção/compressão presentes no SQL estão comentadas e não equivalem a uma rotina automática já ativa.

**Conferência:** há registro de restauração bem-sucedida, responsável por renovação dos certificados e alerta para falha de backup. Não usar `infra:reset`, remoção de volumes ou recriação destrutiva para resolver problemas de produção.

## Etapa 12 Testes de aceitação no condomínio

**Responsáveis:** instalador, integrador, tecnologia e síndico. **Resultado:** todos os itens aplicáveis aprovados com data e evidência. “Não se aplica” exige justificativa; não serve para omitir uma funcionalidade contratada.

| Teste | Resultado necessário para aprovação | Evidência a guardar |
|---|---|---|
| Acesso e perfis | Administrador, síndico e morador com permissões corretas; outro condomínio inacessível | Contas de teste e resultados |
| Água no reservatório | Percentual e litros dentro da tolerância aprovada | Medição física e tela com horário |
| Medidores de consumo | Diferença entre acumuladores físicos compatível com o sistema | Leituras inicial/final e período |
| Fases e temperatura | Valores correspondem ao instrumento e limites aprovados | Ficha do instalador |
| Bomba | Estado, ciclo e duração conferidos; alerta no limite ensaiado | Horários e alerta |
| Água e esgoto | Detecções independentes chegam ao equipamento correto | Método de teste e eventos |
| Gás e incêndio | Ensaio do fabricante chega ao painel; sistema local preservado | Registro do responsável técnico |
| Dados ausentes | Perda de leitura não vira valor normal ou consumo zero | Captura antes/depois |
| Consumo fora do padrão | Limite explícito dispara; referência aprendida validada após dados suficientes | Configuração e histórico |
| Garagem | Uma solicitação válida gera um acionamento correto | Pedido, ACK e observação física |
| Pedestre | Uma solicitação válida gera um acionamento correto | Pedido, ACK e observação física |
| Reconexão dos acessos | Comando antigo não é executado; duplicata não repete abertura | Ensaio supervisionado |
| Permissão de acesso | Morador sem autorização ou vínculo revogado tem pedido recusado | Resultado da tentativa |
| Vagas | Carros/motos independentes; limite e validade respeitados | Contagem física e tela do morador |
| Avisos | Publicação, encerramento e repetição corretos no fuso escolhido | Consulta com perfil morador |
| Reservas e serviços | Conflito, aprovação/cancelamento e andamento funcionam | Protocolos de teste |
| Alertas externos | Responsável recebe HIGH/CRITICAL, se contratado | Entrega e identificação do evento |
| Queda de rede | Indisponibilidade indicada; recuperação conforme o projeto | Horários e dados recuperados |
| Retorno de energia | Serviços e gateway voltam; sem acionamento remoto inesperado | Registro de ensaio seguro |
| Backup | Restauração isolada abre e recupera dados conferidos | Log e tempo de recuperação |
| Certificados | HTTPS e MQTTS válidos; renovação e responsável definidos | Datas e registro do procedimento |

Cada evidência deve identificar o equipamento, data, executor, resultado e tolerância quando houver medição. Anotar também o tempo medido entre uma leitura e sua visualização/alerta; comparar com a meta acordada na Etapa 1.

**Liberação:** corrigir itens reprovados antes do aceite. Se a análise histórica ainda estiver em aprendizado, registrar esse módulo como pendente e manter operação assistida com limites explícitos. Não assinar a conclusão integral de um recurso que ainda depende de integração ou teste.

## Etapa 13 Operação assistida e entrega à equipe

**Responsáveis:** síndico e suporte. **Resultado:** pessoas treinadas e dados reais acompanhados.

1. Acompanhar os primeiros dias e todos os horários representativos do condomínio. Como referência de organização, reservar ao menos uma semana de observação, ampliando até completar o aprendizado escolhido e resolver as pendências. Isso é um período sugerido, não uma garantia automática de aceite.
2. Comparar consumo, tempo de bomba e ocupação com a rotina física. Corrigir erro de unidade, sensor invertido, relógio ou frequência antes de apenas aumentar limites para silenciar alertas.
3. Treinar síndico e zelador: interpretar leitura antiga, atender alerta, publicar aviso, administrar reserva, acompanhar serviço, atualizar vagas e solicitar acesso.
4. Orientar moradores sobre acesso individual, consulta de avisos/vagas, reservas, ocorrências e uso autorizado dos portões.
5. Entregar inventário, mapa de instalação, configurações aprovadas, protocolos de teste, contatos de suporte e rotinas de contingência. Guardar senhas em cofre separado.
6. Registrar aceite com campos abaixo. Transferir os acessos de administração ao responsável definido e encerrar credenciais temporárias de instalação quando cabível.

| Campo do termo de entrega | Preenchimento |
|---|---|
| Condomínio e endereço | Preencher |
| Versão do software e data de implantação | Preencher |
| Inventário de equipamentos e versões de firmware | Referência do arquivo |
| Itens aprovados e evidências | Referência do checklist |
| Pendências com responsável e prazo | Preencher ou registrar nenhuma |
| Último teste de restauração e tempo obtido | Preencher |
| Responsável pela operação e substituto | Preencher |
| Responsável técnico e suporte | Preencher |
| Aceite do síndico e data | Preencher |

## Etapa 14 Rotina de manutenção e solução de problemas

### Rotina sugerida

| Frequência | Atividade | Responsável |
|---|---|---|
| Diária | Conferir alertas, leituras recentes, consumo e situações sem informação | Operação do condomínio |
| A cada turno ou prazo de validade | Renovar contagem manual de vagas e conferir exceções | Portaria ou responsável pela contagem |
| Semanal | Conferir avisos, reservas, serviços pendentes e relatório de backups | Gestão e tecnologia |
| Mensal | Revisar acessos, validade de certificados, capacidade do servidor e teste de recuperação conforme política | Tecnologia |
| Conforme fabricante e plano local | Inspecionar, limpar, calibrar e testar sensores, centrais e portões | Manutenção habilitada |
| Após troca de morador/equipamento ou atualização | Rever permissões/configuração e repetir os testes afetados | Gestão e integrador |

### Diagnóstico por sintoma

| Sintoma | Conferir primeiro | Providência |
|---|---|---|
| Não consigo entrar | Endereço, internet, conta e vínculo | Acionar administrador; não reutilizar conta de outro morador |
| Painel abre mas não atualiza | Última leitura, gateway e ingestão | Conferir cadeia sensor → gateway → broker → ingestão → API |
| Gateway não conecta | DNS, certificado, relógio, senha e clientId | Corrigir configuração sem desativar a validação TLS |
| Sensor aparece online com valor estranho | Unidade, escala, registrador, polaridade e qualidade | Comparar com leitura física e corrigir no integrador |
| Consumo não é calculado | Duas amostras válidas, vínculo do perfil e intervalo máximo | Corrigir frequência e aguardar dados; não preencher ausência com zero |
| Análise fica em aprendizado | Dias válidos recentes e cobertura | Corrigir lacunas; aguardar o número configurado de dias |
| Portão indisponível | Permissão, habilitação e presença do controlador em até 60 s | Verificar no local e usar o procedimento de acesso existente |
| Pedido de portão expirou | ACK, conexão, relógio e execução física | Conferir local antes de novo pedido; não reenviar fila antiga |
| Vagas somem ou ficam antigas | Horário e validade da contagem | Fazer nova contagem ou recuperar sensor; não exibir estimativa como atual |
| Aviso não aparece | Publicação, expiração, prédio e fuso | Corrigir agenda e testar como morador |
| WhatsApp ou e-mail não chegou | Gravidade, configuração e log do integrador | Confirmar entrega externa e atender pelo canal de contingência |
| Backup falhou ou disco está cheio | Log, espaço e destino externo | Acionar tecnologia; preservar dados e verificar recuperação |

## Anexo A Instalação técnica em servidor Linux

Esta parte é para quem administra a hospedagem. Os comandos usam Bash no servidor Linux, a partir da raiz do repositório. Não copiá-los para o PowerShell de demonstração. Substituir os campos indicados e executar uma etapa de cada vez, verificando o resultado. Os procedimentos de produção abaixo devem ser ensaiados em homologação; a validação de 23/09/2026 foi local, e não uma implantação pública com estes domínios.

### A1 Preparação

1. Instalar Docker Engine e Compose conforme a distribuição suportada e a [documentação oficial do Docker](https://docs.docker.com/engine/install/).
2. Transferir uma versão identificada do repositório para o servidor. Registrar commit ou pacote entregue; confirmar que inclui os módulos e as migrações 001 a 011. Em instalação existente, aplicar as migrações adicionais sem apagar os dados e publicar API e painéis compatíveis juntos.
3. Instalar Node.js compatível se for usar o gerador de segredos abaixo no host. As imagens da aplicação usam Node 22 e o projeto fixa pnpm 10.17.1.
4. Definir os cinco registros DNS: api, admin, sindico, morador e mqtt, todos sob o domínio escolhido. Conferir A e eventual AAAA; endereço IPv6 incorreto também pode impedir acesso/certificado.
5. Liberar 80/443 para web e 8883 para os gateways. Restringir administração do servidor por rede autorizada. Não publicar banco 5432, API interna 3000, MQTT interno 1883 ou painel EMQX 18083 diretamente.
6. No Compose de produção, substituir a tag mutável `latest-pg16` por uma versão/digest de TimescaleDB homologada pela equipe e registrá-la. Fixar versões evita alteração involuntária do banco ao obter novas imagens.

### A2 Arquivo de configuração e certificados

```bash
cp infrastructure/.env.prod.example infrastructure/.env.prod
chmod 600 infrastructure/.env.prod
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Executar o gerador separadamente para cada segredo. Preencher o arquivo com valores exclusivos e sem espaços indevidos. Não compartilhar o conteúdo nem registrar a saída de comandos que revelem os segredos.

| Variável | Preenchimento |
|---|---|
| DOMAIN | Domínio base sem https, por exemplo condominio.exemplo.com.br |
| ACME_EMAIL | E-mail monitorado do responsável pelos certificados |
| POSTGRES_PASSWORD | Senha exclusiva da administração do banco |
| APP_DB_PASSWORD | Senha diferente para a conta restrita da API |
| JWT_SECRET | Segredo aleatório de pelo menos 32 caracteres |
| MQTT_AUTH_SECRET | Segredo aleatório compartilhado apenas por API e broker |
| MQTT_INGEST_USERNAME | Identidade do serviço de ingestão, como predioon_ingest |
| MQTT_INGEST_PASSWORD | Senha exclusiva desse serviço |
| EMQX_DASHBOARD_PASSWORD | Senha exclusiva da administração do broker |
| MQTT_CERTS_DIR | Diretório absoluto com fullchain.pem e privkey.pem |
| ALERT_WEBHOOK_URL | Endpoint HTTPS do integrador, se houver |
| SEED_PASSWORD | Não é usado na instalação real sem seed |

O script carrega esse arquivo como Bash. Usar segredos em base64url como no exemplo; se uma URL tiver caracteres especiais, usar a forma de aspas compatível com Bash e Compose. Nunca colocar comandos no arquivo.

O certificado MQTT precisa cobrir exatamente `mqtt.DOMAIN`. Emiti-lo por uma autoridade confiável e disponibilizar cadeia e chave nos nomes acima, com permissão de leitura para o usuário do EMQX e acesso restrito aos demais. Configurar renovação e recarga do broker no procedimento da autoridade utilizada. O Caddy obtém os certificados dos serviços web, mas não coloca automaticamente o certificado do broker nesse diretório.

### A3 Subir uma instalação nova

Os comandos seguintes criam o schema e sobem os serviços. São destinados a banco novo. Para banco existente, seguir a revisão, backup e homologação da Etapa 11; o script usa atualização forçada de schema.

```bash
docker compose -f infrastructure/docker-compose.prod.yml \
  --env-file infrastructure/.env.prod config --quiet
docker compose -f infrastructure/docker-compose.prod.yml \
  --env-file infrastructure/.env.prod build api
bash infrastructure/setup-prod.sh
docker compose -f infrastructure/docker-compose.prod.yml \
  --env-file infrastructure/.env.prod ps
```

Não acrescentar `--seed`. O script prepara o banco e aplica todos os arquivos `infrastructure/0*.sql`, incluindo consumo, acessos, vagas e agenda. Se houver erro, parar nesse ponto, identificar a causa e repetir apenas após a correção. Não apagar o volume para contornar o erro.

### A4 Conferir os serviços

```bash
curl --fail https://api.SEUDOMINIO/health/ready
docker compose -f infrastructure/docker-compose.prod.yml \
  --env-file infrastructure/.env.prod logs --tail 100 api ingest emqx
openssl s_client -connect mqtt.SEUDOMINIO:8883 \
  -servername mqtt.SEUDOMINIO -verify_return_error </dev/null
```

Esperar resposta de banco disponível, ausência de falhas de conexão repetidas e certificado MQTT válido. Conferir os logs sem compartilhá-los integralmente quando contiverem dados operacionais. Criar o primeiro administrador pelo Anexo B e seguir os cadastros reais. Finalizar com uma mensagem do gateway autenticado e sua visualização no painel.

## Anexo B Primeira conta administrativa

O sistema não tem cadastro público para criar o primeiro administrador. Este procedimento é exclusivo da equipe com acesso ao servidor, em instalação nova, e não cria usuários de demonstração. Se já existir administrador ativo, interrompe sem alterar a conta existente.

### B1 Preparar o script no servidor

Na raiz do repositório, criar `bootstrap-first-admin.mjs` com o conteúdo abaixo. O arquivo contém a lógica, sem a senha.

```javascript
import postgres from 'postgres';
import { hash } from '@node-rs/argon2';
import { randomUUID } from 'node:crypto';

const email = (process.env.BOOTSTRAP_EMAIL || '').trim().toLowerCase();
const name = (process.env.BOOTSTRAP_NAME || '').trim();
const password = process.env.BOOTSTRAP_PASSWORD || '';
if (!email.includes('@') || name.length < 2 || password.length < 16) {
  throw new Error('Informe nome, email e senha com pelo menos 16 caracteres');
}
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const passwordHash = await hash(password);
  await sql.begin(async tx => {
    await tx`LOCK TABLE users IN EXCLUSIVE MODE`;
    const rows = await tx`
      SELECT id FROM users
      WHERE is_platform_admin = true AND active = true LIMIT 1
    `;
    if (rows.length) throw new Error('Já existe administrador ativo');
    await tx`
      INSERT INTO users
        (id, email, name, password_hash, is_platform_admin, active)
      VALUES
        (${`usr_${randomUUID()}`}, ${email}, ${name},
         ${passwordHash}, true, true)
    `;
  });
  console.log('Administrador inicial criado');
} finally {
  await sql.end();
}
```

### B2 Informar os dados e executar

Os dados são lidos no terminal e repassados à execução temporária. A senha não é escrita como argumento literal no histórico do terminal. Executar em sessão privada, sem gravação de tela ou depuração de shell.

```bash
read -r -p 'Nome do administrador: ' BOOTSTRAP_NAME
read -r -p 'Email do administrador: ' BOOTSTRAP_EMAIL
read -r -s -p 'Senha exclusiva com 16 ou mais caracteres: ' BOOTSTRAP_PASSWORD
printf '\n'
export BOOTSTRAP_NAME BOOTSTRAP_EMAIL BOOTSTRAP_PASSWORD
docker compose -f infrastructure/docker-compose.prod.yml \
  --env-file infrastructure/.env.prod run --rm -T --no-deps \
  -e BOOTSTRAP_NAME -e BOOTSTRAP_EMAIL -e BOOTSTRAP_PASSWORD \
  api pnpm --filter @predioon/db exec node --input-type=module \
  < bootstrap-first-admin.mjs
unset BOOTSTRAP_NAME BOOTSTRAP_EMAIL BOOTSTRAP_PASSWORD
```

A senha fica temporariamente no ambiente do processo, acessível a administradores do host/Docker durante a execução; limitar esse acesso. Se o comando falhar, ainda executar o `unset` e investigar a mensagem. Não trocar o script por atualização indiscriminada de contas existentes. Após sucesso, entrar no painel administrador e registrar quem realizou o provisionamento e quando. O bootstrap direto não passa pela auditoria da API.

## Anexo C Cópia do banco e ensaio de recuperação

Executar no Bash do servidor por responsável técnico. Os comandos de cópia usam o Compose de produção, sem mostrar senhas. A restauração deve ocorrer em outro servidor/ambiente isolado, sem conexão com portões reais ou envio real de alertas.

### C1 Gerar e conferir a cópia

```bash
set -euo pipefail
umask 077
mkdir -p backups
backup_file="backups/predioon-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose -f infrastructure/docker-compose.prod.yml \
  --env-file infrastructure/.env.prod exec -T db \
  pg_dump -U predioon -d predioon -Fc > "$backup_file"
test -s "$backup_file"
sha256sum "$backup_file" > "$backup_file.sha256"
docker compose -f infrastructure/docker-compose.prod.yml \
  --env-file infrastructure/.env.prod exec -T db \
  pg_restore --list < "$backup_file" > "$backup_file.list"
```

Verificar o código de saída de cada comando. Arquivo não vazio ou lista legível não substituem o teste de restauração. Copiar os três arquivos para armazenamento externo protegido, junto do registro de versão, sem anexar segredos em texto simples. O agendamento, retenção e alerta por falha devem ser configurados pela equipe; este procedimento não agenda backups sozinho.

### C2 Restaurar em laboratório isolado

Preparar uma instância PostgreSQL/TimescaleDB compatível com as versões registradas, com a role proprietária `predioon` e a role restrita `predioon_app` criadas. O dump do banco não cria as roles globais. Manter o destino sem dados e sem serviços de aplicação até terminar.

No cliente administrativo conectado ao destino, criar o banco vazio e a extensão, preparar a restauração, carregar o dump e finalizar o modo de restauração, conforme a [documentação oficial do TimescaleDB](https://docs.timescale.com/self-hosted/latest/backup-and-restore/logical-backup/):

```sql
CREATE DATABASE predioon OWNER predioon;
\connect predioon
CREATE EXTENSION IF NOT EXISTS timescaledb;
SELECT timescaledb_pre_restore();
```

```bash
pg_restore --exit-on-error --dbname=predioon predioon-ARQUIVO.dump
```

```sql
SELECT timescaledb_post_restore();
```

Executar com conexão e permissões administrativas do laboratório. Não usar a opção paralela `-j` nesse fluxo. Conferir erros, permissões, contagens e datas das amostras; testar login e isolamento com uma API apontada para o laboratório. Registrar duração e evidências. Conservar a produção intacta durante todo o ensaio.

### C3 Recuperação de incidente e atualização

Em incidente real, o responsável deve confirmar o destino, suspender as escritas afetadas, preservar a instalação atual e escolher uma cópia validada. Restaurar primeiro em destino separado, conferir e somente então planejar a troca de conexão. Não restaurar por cima do banco ativo como primeira tentativa. Se o schema mudou, voltar apenas a imagem da aplicação pode não ser suficiente; o plano de retorno deve incluir a compatibilidade do banco.

## Referências técnicas do projeto

| Documento | Quando consultar |
|---|---|
| `docs/REVISAO_FUNCIONALIDADES.md` | Escopo implementado, evidências locais e limites |
| `docs/DEPLOY.md` | Infraestrutura e serviços de produção |
| `docs/HARDWARE_SOFTWARE.md` | Arquitetura de campo e identidade das mensagens |
| `docs/SENSORES.md` | Tipos, métricas, unidades e cenários de ensaio |
| `docs/CONSUMO_E_ANALISE.md` | Cálculo de consumo, custos, cobertura e aprendizado |
| `docs/ACESSOS.md` | Contrato do controlador, comandos e confirmação |
| `docs/VAGAS_AVISOS.md` | Vagas, validade de contagem e agenda |
| `docs/SUPORTE_REMOTO.md` | Preparação do computador, AnyDesk e histórico de suporte |
| `docs/GESTAO_TRANSPARENTE.md` | Chamados, gravidade, agrupamento, transparência e contas |

A data deste manual identifica o código consultado. Revalidar os trechos afetados quando houver atualização do software, troca de equipamento ou mudança das regras de operação.
