# Estado da entrega — Prédio ON

## Implementado e validado localmente

- Cadastros de clientes, prédios, gateways, dispositivos, métricas e usuários.
- Autenticação JWT, Argon2, refresh rotativo e isolamento por prédio com RLS.
- MQTT genérico e contrato compacto de caixa d'água; validação, gravação atômica,
  histórico, deduplicação, regras e alertas.
- Credenciais por gateway, autenticador e autorizador HTTP do EMQX, configuração
  TLS de produção e teste integrado com EMQX 6.3.1.
- Painéis de administrador, síndico e morador adaptados ao celular; água, energia,
  avisos, ocorrências e reservas. Nenhum botão para abrir portão.
- Atualizações SSE no painel inicial do síndico e consulta periódica de recuperação.
- Detecção de gateway/dispositivo offline e auditoria de alterações.

## Configuração para instalar no condomínio

- Manual do sensor, mapa Modbus e firmware do gateway que faça a leitura RS485.
- Domínio, servidor, certificados e segredos exclusivos. Consulte [DEPLOY.md](DEPLOY.md).
- Cadastro real dos equipamentos e usuários, limites de alerta e comissionamento físico.
- Provedor de WhatsApp/e-mail conectado ao webhook, caso esses canais sejam contratados.
- Backup, restauração, monitoramento e política de retenção do histórico.

## Evoluções fora da entrega atual

- Aplicativos nativos, fluxo dedicado de técnico e anexos de fotos.
- Integração com CFTV, financeiro e documentos com armazenamento de arquivos.
- Detecção preditiva por IA após reunir histórico representativo e validar os resultados.
- Certificados individuais por dispositivo (mTLS).

As imagens fornecidas são referência para a interface e para essas possíveis evoluções.
O escopo executável e as evidências de validação estão em [ENTREGA_HELBER.md](ENTREGA_HELBER.md).
