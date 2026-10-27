# Roteiro de demonstração para clientes

Apresentação de cerca de 20 minutos com o Jardim das Palmeiras · DEMO. Tudo roda de verdade: portais na Vercel, banco no Neon, e o "campo" (broker, ingestão e gateway simulado) numa VM Oracle. Os equipamentos são simulados, e os avisos do próprio ambiente já dizem isso ([DEMO_CAMPO.md](DEMO_CAMPO.md), [VERCEL_NEON.md](VERCEL_NEON.md)).

| Quem | Endereço |
| --- | --- |
| Síndico | https://predioon-sindico.vercel.app |
| Morador | https://predioon-morador.vercel.app |
| Administração da plataforma | https://predioon-admin.vercel.app |
| Totem (no tablet) | https://predioon-sindico.vercel.app/totem |

Use três janelas lado a lado: **síndico** (tela grande), **morador** (janela estreita, parecida com celular) e **administração** (só você, para disparar cenários).

## 1. Antes de começar (30 minutos antes)

1. **Campo ligado.** Confira na VM que os três contêineres estão saudáveis:
   ```sh
   ssh -i ~/.ssh/predioon_demo_oracle opc@144.22.139.232 "docker ps --format '{{.Names}} {{.Status}}'"
   ```
   Se estiver parado: `docker compose -f infrastructure/docker-compose.demo-field.yml --env-file infrastructure/.env.demo-field start` dentro de `~/predioON`. O gateway volta online em até 15 s.
2. **Acorde o banco.** Abra uma vez Início, Alertas, Acessos e Vagas no síndico. A primeira consulta depois de uma pausa pode demorar. Se aparecer "Erro interno", recarregue. Se persistir, Neon › Computes › Restart compute.
3. **Faça login** nas três janelas antes de o cliente chegar.
4. **Cenário em "Tudo normal"** (Administração › Demonstração).
5. **Não reinicie o campo** antes da apresentação.
6. **Tablet do totem** carregado e na página `/totem`, se for mostrar o QR.

Confira no painel do síndico: 14 de 14 equipamentos online, água perto de 60%, leituras com "agora".

## 2. O roteiro

### Abertura (2 min): o painel do síndico
**Início.** "Aqui está o condomínio hoje": água, energia, bomba, vazamento, temperatura e comunicação, atualizados a cada 10 segundos. Mostre os alertas recentes, os avisos e os chamados abertos.
**Mensagem:** tudo num lugar só, sem planilha.

### Água e energia (3 min)
1. **Água e reservatórios:** nível, volume, bomba e histórico.
2. **Energia e fases:** tensão nas três fases.
3. **Consumo e análise:** acumulado do dia, custo estimado e referência aprendida.

**Mensagem:** o síndico enxerga o consumo e a conta antes de ela chegar.

### O momento forte (4 min): um problema acontece
1. Na administração: **Demonstração › Vazamento de água**.
2. Volte ao síndico › **Alertas**. Em até uns 10 segundos aparece "Possível vazamento de água". Abra os detalhes e o próximo passo sugerido.
3. No **Início**, o cartão Vazamento passa a indicar detecção.
4. Marque o alerta como reconhecido e depois resolvido.
5. Volte o cenário para **Tudo normal**.

**Mensagem:** o sistema avisa na hora, sem ninguém ter de olhar o sensor.

### Do alerta à manutenção (2 min)
1. Administração: **Caixa d'água baixando**.
2. Em cerca de um minuto surge o alerta de nível baixo e, sozinha, uma **Ordem de serviço** "Inspeção preventiva do equipamento" (síndico › Ordens de serviço).
3. Mostre Automações: "Nível de água baixo abre inspeção" e "Alerta elétrico aciona manutenção" ativas.
4. Volte para **Tudo normal**. A caixa se recupera na hora.

Depois, cancele ou conclua a ordem de serviço criada, para a próxima apresentação começar limpa.

**Mensagem:** o alerta vira ação, sem depender de alguém lembrar.

### Portões e acessos (4 min)
1. **Síndico › Portões e acessos.** Mostre o Portão da garagem e a Portaria de pedestres.
2. **Morador › Acessos.** Toque em **Abrir entrada**. Aparece "Execução reconhecida pelo controlador", com horário. O portão só abre se o controlador estiver online.
3. **QR do totem (adicional da plataforma).** No síndico, **Parear tablet** gera um código de 10 caracteres válido por 10 minutos. No tablet, abra `/totem` e digite o código. O tablet passa a mostrar um QR que muda a cada hora. No app do morador, leia o QR, confira o portão e toque em **Abrir**.
4. Mostre a opção **Exigir QR do totem para moradores**: marcada, ninguém abre só pela lista.

**Mensagem:** acesso controlado, com registro de quem abriu e quando. O QR só vale se a pessoa estiver diante do portão.

### Vagas (1 min)
**Vagas de carros e motos:** livres e ocupadas, origem "Sensor automático" e horário da última contagem. Atualize a página e mostre os números mudando.

### A comunidade (3 min)
1. **Avisos:** publicar, agendar, fixar.
2. **Chamados:** a fila, a gravidade e a resposta ao morador. Mostre no app do morador o mesmo chamado.
3. **Áreas comuns:** aprove uma reserva pendente.
4. **Transparência:** prestação de contas mensal, com rascunho e publicação.
5. **Ativos e Ordens de serviço:** bomba, elevador, gerador, com histórico.

### Fechamento (1 min)
Volte ao Início. "Água, energia, acessos, vagas, alertas, chamados e contas no mesmo lugar." Pergunte qual parte interessa mais ao condomínio dele.

## 3. Outros cenários (use se o cliente perguntar)

Todos em Administração › Demonstração. Volte sempre para **Tudo normal**.

| Botão | O que o cliente vê |
| --- | --- |
| Queda de energia | Fase L3 sem tensão, alerta crítico, bomba desliga |
| Vazamento de gás | Detecção de gás e concentração em ppm, alerta crítico |
| Fumaça detectada | Relé da central de incêndio, alerta crítico |
| Vazamento de esgoto | Alerta no subsolo |
| Consumo de energia alto / de água alto | Desvio do consumo de referência |
| Bomba ligada demais | Alerta de tempo de funcionamento |
| Sensor travado | O painel distingue sensor travado de sensor saudável |
| Gateway fora do ar | O sistema percebe a falta de comunicação sozinho |

## 4. Se algo falhar

| Sintoma | O que fazer |
| --- | --- |
| "Erro interno" ao abrir uma tela | Recarregue. Se repetir, Neon › Computes › Restart compute e espere 1 minuto. |
| Portão não abre, "sem conexão recente" | O campo está parado. Inicie-o pela VM e espere 15 s. |
| Alerta do cenário não aparece em 1 minuto | Confira o cenário atual na tela Demonstração e os logs: `docker logs --tail 20 predioon-demo-field-ingest-1` na VM. |
| Lista de Gateways vazia na administração | É esperado: a plataforma só vê equipamentos com Acesso de suporte concedido ao condomínio. Mostre os gateways pelo síndico. |

## 5. Depois da apresentação

1. Cenário em **Tudo normal**, alertas de teste resolvidos, ordem de serviço de teste cancelada ou concluída.
2. **Pause o campo** para não gastar as horas de computação do Neon gratuito (cerca de 100 por mês):
   ```sh
   ssh -i ~/.ssh/predioon_demo_oracle opc@144.22.139.232 "cd predioON && docker compose -f infrastructure/docker-compose.demo-field.yml --env-file infrastructure/.env.demo-field stop"
   ```
3. O IP da VM é efêmero. Se a Oracle parar a máquina, ele muda.

## 6. Limites que vale dizer com clareza

- Equipamentos, leituras e condomínio são simulados. A homologação com hardware real é outra etapa ([IMPLANTACAO_CONDOMINIO.md](IMPLANTACAO_CONDOMINIO.md)).
- "Execução reconhecida" significa que o controlador confirmou o comando; a posição física do portão não é medida.
- O QR do totem é um adicional liberado pela plataforma por condomínio.
