# Entrega técnica — Prédio ON

## Versão local de 21/09/2026

A plataforma conserva os três acessos: administrador, síndico e morador. Os painéis oferecem cadastros, monitoramento, histórico, regras, alertas, avisos, ocorrências e reservas. Não existe abertura remota de portões.

Fluxo implementado:

```text
Sensor ultrassônico → RS485 / Modbus RTU → gateway
  → MQTT / TLS → EMQX → ingestão e validação
  → PostgreSQL / TimescaleDB → API → painel e alertas
```

O gateway é o computador embarcado responsável pela leitura Modbus; não precisa de PC intermediário. O firmware e os registradores do equipamento dependem do fabricante e não foram inventados nesta entrega.

## Contrato para Helber

Tópico:

```text
predio/{id_predio}/caixa_agua/{id_sensor}/telemetria
```

Mensagem:

```json
{
  "device_id": "sensor_01",
  "type": "nivel_caixa_agua",
  "nivel_percentual": 78,
  "distancia_mm": 650,
  "volume_litros": 3900,
  "timestamp": "2026-09-16T22:45:00Z"
}
```

Use os identificadores reais do cadastro: no condomínio de demonstração, `bld_001` e `water_01`. Nível é número entre 0 e 100. Distância e volume são opcionais, não negativos; devem ser omitidos quando não forem medidos. Timestamp deve ser ISO 8601 com fuso, preferencialmente UTC, e corresponder à medição. Não reenviar o timestamp fixo do exemplo para uma leitura nova.

O serviço normaliza a mensagem para `water_level_percent`, `distance_mm` e `volume_liters`. Grava as métricas na mesma transação. Identidade do tópico deve coincidir com a mensagem e o cadastro. O par sensor/métrica/timestamp identifica a amostra compacta: uma retransmissão não duplica o histórico. O formato genérico `predio/{id}/device/{id}/telemetry` continua aceito com seu `eventId` original.

A regra de nível abaixo de 20% cria um alerta para uma leitura de 18%. Limites e prioridade podem ser alterados em **Regras**. O painel recebe atualizações por SSE e consulta novamente a API periodicamente como recuperação. A qualidade é preservada; dados ausentes não viram zero e leituras antigas são identificadas.

## Conexão de campo

1. Cadastrar condomínio, gateway e sensor no painel administrador, vinculando cada sensor ao seu gateway.
2. Emitir a credencial do gateway. A senha aparece uma vez; o banco guarda apenas o hash.
3. Configurar host `mqtt.SEUDOMINIO`, porta 8883, TLS com validação do certificado, usuário/senha emitidos e `clientId` igual ao ID do gateway.
4. Publicar QoS 1 nos tópicos informados. Publicar status retido e registrar o status OFFLINE como Last Will.
5. Testar perda de conexão, retransmissão, leitura de 18% e retorno de leitura normal. Alertas abertos devem ser tratados no painel.

O broker de produção valida autenticação e autorização pela API interna. Cada gateway só publica nos sensores vinculados a ele e no próprio tópico de status; não pode assinar tópicos ou enviar comandos. O serviço de ingestão só assina os filtros autorizados. Desativar o gateway bloqueia novas autenticações e publicações; rotação de senha exige desconectar a sessão antiga no broker quando for necessária revogação imediata.

## Execução local

```powershell
pnpm install
pnpm setup:local
pnpm dev
```

Em outro terminal:

```powershell
pnpm simulate:hardware
```

| Acesso | Endereço | Conta de demonstração |
|---|---|---|
| Administrador | http://localhost:5173 | admin@predioon.local |
| Síndico | http://localhost:5174 | sindico@predioon.local |
| Morador | http://localhost:5175 | morador@predioon.local |

Senha das contas de demonstração: `predioon123`. Os valores exibidos nesta demonstração vêm do simulador e do histórico local, não de sensores físicos instalados.

## Validação realizada

- 37 testes automatizados aprovados: interface lógica e sessão (9), API/autenticação/isolamento/reservas (15) e ingestão (13).
- Compilação dos três painéis e dos serviços.
- EMQX 6.3.1 isolado: conexão TLS com validação de certificado, credencial gerada pela API, publicação do nível 18%, gravação de três métricas, alerta, consulta pela API e retransmissão sem duplicação.
- Broker rejeitou credencial incorreta e publicação no sensor de outro gateway.
- Conferência de navegação dos painéis no navegador, incluindo tamanho de celular.
- Reserva criada/cancelada pelo morador; ocorrência aberta pelo morador e concluída pelo síndico.
- Renovação de sessão compartilhada entre consultas simultâneas, com teste de regressão.
- Consulta de últimas leituras: aproximadamente 14,0 s antes e 0,72 s depois da revisão da política RLS, no banco local com mais de 420 mil amostras. Medição local, não garantia de desempenho em outros servidores.

O teste TLS rodou dentro da rede Docker porque o antivírus local interceptava o certificado de teste. A validação de certificados permaneceu ativada. As verificações finais de testes, tipos e compilação foram executadas com `--workspace-concurrency=1` por disponibilidade de memória do computador. O build avisa sobre o tamanho do pacote de gráficos do painel do síndico; não houve erro de compilação.

O roteiro de repetição do teste integrado está em [TESTE_MQTT.md](TESTE_MQTT.md).

## Para instalação real

- Fornecer manual/modelo do sensor e mapa Modbus: endereços, função de leitura, unidade, escala e parâmetros da porta serial.
- Instalar certificado válido do domínio MQTT, configurar DNS e segredos de produção. O Compose já contém o autenticador e autorizador HTTP e a configuração TLS; os certificados não são gerados automaticamente pelo Caddy para MQTT.
- Configurar `ALERT_WEBHOOK_URL` se desejar WhatsApp ou e-mail. Sem provedor configurado, os alertas ficam no painel e nos logs; não se declara mensagem enviada.
- App nativo de técnico/morador, fotos, CFTV, financeiro e IA preditiva não fazem parte dos módulos executáveis atuais. As imagens são referência visual; as telas não inventam serviços, câmeras ou análises de IA.
- Validar hardware no condomínio e operação em produção. Esta entrega foi testada localmente, sem publicar uma nova versão externa.

Veja `DEPLOY.md` para configuração de produção e `HARDWARE_SOFTWARE.md` para contexto da instalação.
