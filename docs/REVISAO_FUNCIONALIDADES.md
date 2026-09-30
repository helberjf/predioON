# Prédio ON — funcionalidades implementadas

Escopo atualizado para a implementação solicitada em 22/09/2026. **Disjuntor/extintor foi retirado por instrução do usuário.** Esta matriz descreve o código local e distingue implementação de validação com hardware físico.

## Monitoramento e automação

| Recurso | Implementação | Referência |
|---|---|---|
| Volume na caixa d'água | Nível, volume em litros e distância quando enviados pelo equipamento; histórico e limites. | [Sensores](SENSORES.md), tela Água |
| Falta de fase e parâmetros | Tensão nas três fases, corrente/frequência quando medidas e regras configuráveis; seed com subtensão/sobretensão por fase. | [Sensores](SENSORES.md), tela Energia |
| Vazamento de água e esgoto | Métricas e pontos distintos, sinais booleanos, regras e painel de sensores. Compatibilidade com leak_detected antigo. | [Sensores](SENSORES.md) |
| Fumaça e temperatura | Sinal do relé de alarme da central, temperatura e limites; contrato, cadastro, tela e simulação. | [Sensores](SENSORES.md) |
| Portão garagem/pedestre | Cadastro, permissões, pedido de abertura, expiração, idempotência, MQTT, confirmação do controlador e auditoria. | [Acessos](ACESSOS.md) |
| Relé da bomba | Estado, tempo contínuo e total diário; alertas por limite ou histórico. | [Consumo e análise](CONSUMO_E_ANALISE.md) |
| Análise de desvios | Modelo estatístico que aprende referência e variação com histórico válido de energia, água e bomba; estado de aprendizado e explicação. Sensores críticos mantêm regras explícitas. | [Consumo e análise](CONSUMO_E_ANALISE.md) |
| Gás | Sinal de detecção e ppm quando enviados pelo equipamento, cadastro, painel, regra e cenário de simulação. | [Sensores](SENSORES.md) |
| Aplicação em diferentes imóveis | Cadastro de condomínio, casa ou imóvel comercial e fuso IANA. | Cadastro de imóveis no painel administrador |

## Avisos e rotina

| Recurso | Implementação |
|---|---|
| Dia da coleta de lixo | Atalho de categoria, data, publicação programada e repetição semanal. |
| Reunião | Aviso com data e hora de ocorrência e período de publicação. |
| Limpeza do hall | Atalho de categoria, data e repetição semanal opcional. |
| Agendamento do salão | Módulo existente de reservas, aprovação, cancelamento e conflito de horários. |
| Caixa de serviços a fazer | Módulo existente de chamados, protocolo, prioridade e situação. |
| Vagas de carro/moto | Contadores separados, capacidade, ocupação e disponibilidade; atualização manual ou sensor, origem/horário e indicação de dado antigo ou desconhecido. |

Detalhes em [Vagas e avisos](VAGAS_AVISOS.md). Os itens 7 a 10 recebidos sem descrição não foram preenchidos com recursos inventados. A agenda calcula a próxima ocorrência e controla a publicação; lembretes por WhatsApp/e-mail não são enviados automaticamente por esse módulo.

## Atendimento transparência e contas

| Recurso | Implementação | Referência |
|---|---|---|
| Suporte remoto | Cadastro do AnyDesk por condomínio, solicitação auditada, abertura no cliente instalado e resultado manual | [Suporte remoto](SUPORTE_REMOTO.md) |
| Chamados de morador e síndico | Abertura pelos dois portais, três gravidades, comentários e histórico | [Gestão transparente](GESTAO_TRANSPARENTE.md) |
| Gravidade alterada pelo síndico | Baixa, média e alta, justificativa obrigatória e histórico ao solicitante | [Gestão transparente](GESTAO_TRANSPARENTE.md) |
| Três chamados iguais | Sugestão por categoria, assunto normalizado e local; confirmação da gestão, resposta e conclusão do grupo | [Gestão transparente](GESTAO_TRANSPARENTE.md) |
| Transparência | Atualizações públicas de decisões, andamento, prazos e serviços, preservando relatos particulares | [Gestão transparente](GESTAO_TRANSPARENTE.md) |
| Prestação de contas | Relatórios mensais em centavos, receitas/despesas, saldo, links de comprovantes, rascunhos privados e publicação com revisões imutáveis | [Gestão transparente](GESTAO_TRANSPARENTE.md) |

## Exemplos de monitoramento

- **R$ 10 → R$ 50/dia:** consumo medido vezes tarifa configurada produz custo estimado; referência de 10 para observado de 50 significa aumento de 400%.
- **Água fora do padrão:** consumo do hidrômetro é comparado com limite e histórico, separado dos sensores locais de vazamento.
- **Bomba 60 → 120 minutos/dia:** o sistema soma intervalos válidos e compara total e duração contínua com os parâmetros.
- **Carros e motos:** dados desconhecidos ou antigos não são mostrados como zero vagas livres.

Um desvio indica necessidade de investigação. O sistema não localiza sozinho uma luminária com fuga nem comprova a causa de um consumo alto.

## Verificação ampliada em 23/09/2026

- **144 testes passaram, sem falhas ou testes pulados:** API 77, ingestão 50 e interface 17. Execução serial por pacote e por arquivo para evitar disputa entre testes que usam o banco e o limite de memória local.
- O comando `pnpm test` agora usa essa execução serial. Rodar com o banco/broker de teste e sem outra instância de ingestão consumindo a mesma fila; iniciar `pnpm dev` depois da validação. A execução simultânea de build e muitos workers de teste atingiu o limite de memória deste computador; a execução serial concluiu sem esse erro.
- `pnpm -r --workspace-concurrency=1 typecheck` e `pnpm -r --workspace-concurrency=1 build` concluíram com sucesso. Permanecem avisos de comentários de dependência e de tamanho de pacote no build.
- Migrações 010 e 011 aplicadas sem reset. AnyDesk validado no navegador até o link nativo, cadastro, recuperação de falha de consulta, resultado e isolamento; nenhuma sessão externa foi iniciada.
- Chamados validados no navegador: abertura por morador e síndico, sugestão de três relatos, agrupamento, justificativa de gravidade, resposta comum, conclusão e histórico privado ao morador.
- Contas validadas no navegador: rascunho invisível ao morador, publicação, saldo de R$ 89,99 para saldo inicial de R$ 100,00 e despesa de R$ 10,01, lançamentos e publicação de atualização da gestão.
- Testes de concorrência confirmam uma única vinculação de grupo, preservação de revisões publicadas, proteção contra sobrescrita de rascunhos e bloqueio de contas/usuários fora do escopo. Publicação imediata de avisos usa o relógio do banco, mesmo com a API adiantada.
- Condomínios, usuários e registros temporários usados na conferência visual foram removidos. Hardware, AnyDesk real e implantação de produção não foram testados nesta entrega.

## Verificação anterior de sensores e automação

- **114 testes automatizados passaram, sem falhas ou testes pulados:** API 51, ingestão 50 e interface 13. A suíte inclui isolamento por imóvel, permissões, MQTT, comandos/ACK, vagas, agenda, consumo, sensores, reservas e sessão.
- A checagem de tipos e o build dos três painéis e dos serviços passaram. Após o ajuste visual final, a checagem de tipos e o build do painel do prédio foram repetidos e passaram. Permanecem avisos não bloqueantes de tamanho do pacote de gráficos e comentários de uma dependência.
- As nove migrações foram reaplicadas, e o complemento de demonstração foi executado com sucesso, preservando os dados existentes.
- **Consumo:** confirmados R$ 50 estimados a partir de 50 kWh e tarifa de R$ 1/kWh, alerta único, aumento de 400% sobre a referência, rejeição de histórico fora de 28 dias, duração diária/contínua de bomba e restrições de escrita por morador.
- **Portões com EMQX real local:** API → fila → broker → controlador simulado → ACK → banco confirmado para garagem e pedestre. A repetição do pedido retornou o mesmo comando sem nova entrega. Os controladores e registros temporários foram removidos ao terminar; os portões do seed continuam desativados.
- **Sensores e consumo ao vivo:** o simulador publica no broker local; ingestão, persistência, API e telas recebem nível/volume, fases, bomba, água/esgoto, gás, fumaça, temperatura e acumuladores de consumo.
- **Navegação autenticada:** conferidos consumo/custo/estado de aprendizado, sensores, vagas separadas e seu formulário, agenda de avisos e acessos do síndico. Conferida a consulta de vagas pelo morador, sem controles de gestão.
- A revisão corrigiu a recuperação de confirmação de portões após falha de rede, preservou a chave idempotente de outro pedido em andamento e impediu regressão causada por respostas fora de ordem.
- A conferência visual corrigiu o cartão inicial de vazamento para usar a métrica canônica water_leak_detected, preservar compatibilidade com o nome antigo e indicar estado desconhecido em leituras antigas/inválidas.
- Não houve instalação, abertura de portão físico ou teste de sensores reais. A validação acima cobre software, banco, broker e simuladores locais.

## Repetir a validação local

No PowerShell, a partir da raiz do projeto, executar cada etapa somente após a anterior terminar sem erro:

```powershell
pnpm infra:up
pnpm db:wait
pnpm db:infra
pnpm --filter @predioon/db exec tsx src/seed-features.ts
$env:RUN_ACCESS_DB_TESTS = '1'
pnpm --filter @predioon/api exec node --import tsx --test --test-concurrency=1 'test/*.test.ts'
pnpm --filter @predioon/ingest exec node --import tsx --test --test-concurrency=1 'test/*.test.ts'
pnpm --filter @predioon/ui test
pnpm -r --workspace-concurrency=1 typecheck
pnpm -r --workspace-concurrency=1 build
pnpm dev
```

O complemento do seed pressupõe o cadastro básico de demonstração existente. Não é necessário apagar volumes ou dados para reaplicar as migrações. Para observar leituras, iniciar o simulador em outro terminal conforme [SENSORES.md](SENSORES.md). O simulador isolado de portões está descrito em [ACESSOS.md](ACESSOS.md).


## Condições de operação

Sensores e controladores precisam seguir os contratos documentados e ser configurados/testados no imóvel. Um ACK confirma a execução informada pelo controlador, sem medir a posição atual do portão. O seed deixa os acessos desativados. Alertas de alta prioridade podem ser encaminhados por webhook; WhatsApp/e-mail exigem integração externa. Fumaça/gás não substituem sistemas certificados.

Materiais atualizados: [apresentação comercial](marketing/APRESENTACAO_COMERCIAL.md) e [exemplos de uso](marketing/CASOS_DE_USO_E_EVOLUCOES.md).
