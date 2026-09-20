# Exemplo de ACL EMQX — Prédio ON

Para um gateway do prédio `bld_001`:

- pode publicar somente em `predio/bld_001/device/+/telemetry`;
- não deve assinar tópicos de outros prédios;
- a plataforma de ingestão assina `predio/+/device/+/telemetry`.

Em produção, use MQTT sobre TLS (`8883`) e credencial exclusiva por gateway. A evolução recomendada é certificado por dispositivo/gateway.
