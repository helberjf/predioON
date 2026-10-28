# Correções da auditoria na versão atual

Esta revisão usa a main em `c68799ad`, preservando sessões, capabilities, apps e migrações mais recentes. O commit experimental `ed99f922`, baseado em uma versão anterior, não deve ser aplicado por inteiro sobre essa arquitetura.

## Permissões e sessões

A autenticação atual resolve a identidade no banco, verifica sessão vigente e conta ativa; as rotas usam capabilities. A rotação de refresh tokens utiliza transação e bloqueio de linha, com revogação da família em caso de reutilização. As migrações atuais substituem o modelo de permissões da auditoria antiga; não reaplicar o SQL 013 da versão histórica.

## Correções adicionais desta revisão

- Last Will OFFLINE passa pelo mesmo processamento transacional de comunicação que persiste status, alerta e entrega pendente. Não depende de aguardar o timeout de heartbeat. A busca de incidente aberto impede duplicação em entregas repetidas.
- Cooldown é consultado por regra e dispositivo, usando a data de processamento do alerta. Um sensor não suprime o incidente de outro. A regra de frescor existente continua descartando leituras antigas para criação de incidentes.
- A limpeza de `pipeline.test.ts` usa exclusivamente os IDs de eventos gerados pela própria execução, condomínio e dispositivo. A fixture administrativa já exige configuração explícita de banco descartável.

## Garantias existentes preservadas

O handler MQTT só libera PUBACK após concluir o processamento. A identidade do evento inclui condomínio/dispositivo. A entrega externa utiliza persistência e recuperação próprias; comandos físicos mantêm sua política específica, sem reaproveitar retentativas de notificações.

## Verificação

Em 28/10/2026: tipagem e build do serviço de ingestão aprovados; nove testes de entrega MQTT aprovados, incluindo reconexão e interrupção do receptor antes/depois da persistência. A integração completa com PostgreSQL e o comissionamento do gateway físico não foram executados nesta rodada. Esses resultados não equivalem à homologação de produção.
