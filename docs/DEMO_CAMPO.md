# Demonstração completa: o prédio "vivo"

Os portais e a API da demonstração rodam na Vercel com o banco no Neon ([VERCEL_NEON.md](VERCEL_NEON.md)). A Vercel não mantém processo ligado, então o "campo" fica numa máquina à parte, a Oracle Cloud Always Free, ligada ao mesmo banco:

| Serviço | O que faz |
| --- | --- |
| `emqx` | Broker MQTT, só na rede interna do compose; nenhuma porta é publicada |
| `ingest` | A ingestão real: grava leituras, gera alertas e envia os comandos de portão |
| `demo-field` | Faz o papel dos gateways dos condomínios de demonstração |

O `demo-field` descobre no banco os equipamentos de cada condomínio listado e publica o que cada tipo publicaria de verdade: caixa d'água, hidrômetro, energia, fases, bomba, vazamentos, gás, fumaça, temperatura, vagas e a presença dos controladores de portão. Ele também responde aos comandos de portão com o ACK do protocolo; nenhum relé ou equipamento real existe ali. Ele só lê o banco, com o login restrito da ingestão.

## Cadência

O ciclo é de 15 s (`DEMO_FIELD_INTERVAL_MS`, de 5 a 30 s). Medidores e controladores de portão publicam a cada ciclo: o consumo precisa de leituras com no máximo 5 minutos de intervalo, e o portão só abre com o controlador visto nos últimos 60 s. Os demais sensores publicam a cada três ciclos ou na hora em que o valor muda. Assim o vazamento de um cenário aparece em segundos, e a ingestão não acumula fila: medido com atraso de 2 s e cerca de 75 leituras por minuto num condomínio.

## Cenários na apresentação

Com `DEMO_SCENARIOS=on` na API, a administração ganha **Demonstração** no menu. Ali o administrador da plataforma escolhe o condomínio e dispara situações como vazamento de água, gás, fumaça, queda de energia, caixa d'água baixando, consumo alto ou gateway fora do ar. A escolha fica em `demo_scenarios` (migration 062), auditada como `DEMO_SCENARIO_CHANGED`, e o gateway simulado a aplica no ciclo seguinte. Sem a variável, a rota só responde `{ "enabled": false }`, e o menu não mostra a página.

## Instalação, uma vez

1. **Banco Neon:** aplicar as migrations e habilitar só os dois logins do campo. Com `--field-only`, as senhas da API na Vercel não são tocadas:
   ```sh
   pnpm --filter @predioon/db db:infra --provider=neon-demo
   pnpm --filter @predioon/db db:provision-runtime --field-only
   ```
   O segundo comando lê `DATABASE_URL` (dono), `DATABASE_URL_INGEST` e `DATABASE_URL_ACCESS_SERVICE`, com senhas novas geradas para os dois logins.
2. **Funcionalidades:** em Funcionalidades, ligar portões e vagas no global, e liberar **Abertura por QR no totem** no condomínio, se for apresentar o totem. Nos portões, marcar **Habilitar abertura remota** e **Permitir abertura por pessoas com autorização**.
3. **Vercel, projeto predioon-api:** acrescentar `DEMO_SCENARIOS=on` e publicar de novo.
4. **Oracle:** máquina Ubuntu ARM (Ampere A1, 1 OCPU e 6 GB bastam), região São Paulo, com a chave SSH pública. Na máquina:
   ```sh
   git clone https://github.com/helberjf/predioON.git && cd predioON
   cp infrastructure/.env.demo-field.example infrastructure/.env.demo-field   # preencher
   bash infrastructure/setup-demo-field.sh
   ```
   O script instala o Docker na primeira vez; entre de novo na sessão SSH e rode outra vez.

Para atualizar o código: `bash infrastructure/setup-demo-field.sh --update`. Para ver o que acontece: `docker compose -f infrastructure/docker-compose.demo-field.yml --env-file infrastructure/.env.demo-field logs -f demo-field ingest`.

## Custo do Neon gratuito

Com a ingestão ligada, o banco do Neon nunca suspende. O plano gratuito tem cerca de 100 horas de computação por mês, e um banco ligado o mês todo passa disso. Para não estourar, ligue o campo só nos dias de apresentação:

```sh
docker compose -f infrastructure/docker-compose.demo-field.yml --env-file infrastructure/.env.demo-field stop    # pausa
docker compose -f infrastructure/docker-compose.demo-field.yml --env-file infrastructure/.env.demo-field start   # volta
```

Ao voltar, o gateway reaparece online em até 15 s. Leituras do período parado não existem; os gráficos mostram o intervalo vazio, como num gateway desligado.

## Limites

- O broker não usa a autenticação HTTP da produção, porque só a ingestão e o gateway simulado o alcançam, dentro da rede do compose. Não publique a porta 1883 nem aponte este compose para um banco com equipamento real.
- O campo não testa TLS de gateway, firmware real nem perda de rede entre o prédio e o servidor. Isso fica para a homologação com hardware ([IMPLANTACAO_CONDOMINIO.md](IMPLANTACAO_CONDOMINIO.md)).
