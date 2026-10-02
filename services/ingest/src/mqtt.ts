import mqtt from "mqtt";
import { readFileSync } from "node:fs";
import { ACCESS_ACK_TOPIC, GATEWAY_STATUS_TOPIC, TELEMETRY_TOPIC, WATER_TELEMETRY_TOPIC } from "@predioon/shared";
import { config } from "./config.js";

export type MessageHandler = (topic: string, payload: Buffer) => Promise<void>;

export function connectIngest(onMessage: MessageHandler): mqtt.MqttClient {
  const client = mqtt.connect(config.MQTT_URL, {
    username: config.MQTT_USERNAME,
    password: config.MQTT_PASSWORD,
    clientId: config.MQTT_CLIENT_ID,
    clean: false, // durable session: messages published while ingest is down are redelivered
    queueQoSZero: false, // A physical command must never wait in an offline outbound queue.
    reconnectPeriod: 2000,
    rejectUnauthorized: true,
    ...(config.MQTT_CA_FILE ? { ca: readFileSync(config.MQTT_CA_FILE) } : {}),
    ...(config.MQTT_CERT_FILE ? { cert: readFileSync(config.MQTT_CERT_FILE) } : {}),
    ...(config.MQTT_KEY_FILE ? { key: readFileSync(config.MQTT_KEY_FILE) } : {}),
  });

  client.on("connect", () => {
    console.log(`MQTT conectado em ${config.MQTT_URL}`);
    client.subscribe([TELEMETRY_TOPIC, WATER_TELEMETRY_TOPIC, GATEWAY_STATUS_TOPIC, ACCESS_ACK_TOPIC], { qos: 1 }, (error) => {
      if (error) console.error("Falha ao assinar tópicos:", error);
      else console.log(`Assinando ${TELEMETRY_TOPIC} e ${GATEWAY_STATUS_TOPIC}`);
    });
  });

  client.on("reconnect", () => console.warn("MQTT reconectando..."));
  client.on("error", (error) => console.error("Erro MQTT:", error.message));

  // MQTT.js sends QoS1 PUBACK only after handleMessage calls back successfully.
  // A detached `message` listener would acknowledge before the DB commit.
  // The tail also serializes a reconnect's delivery behind an older transaction.
  let processing: Promise<void> = Promise.resolve();
  client.handleMessage = (packet, done) => {
    const stream = client.stream;
    const isCurrent = () => stream === client.stream && !stream.destroyed && !client.disconnecting;
    const delivery = processing.then(async () => {
      if (!isCurrent()) return false;
      await onMessage(packet.topic, Buffer.isBuffer(packet.payload) ? packet.payload : Buffer.from(packet.payload));
      return isCurrent();
    });
    processing = delivery.then(() => undefined, () => undefined);
    void delivery.then(current => {
      // Late callbacks belong to their original connection, even when message
      // IDs have been reused by a replacement connection. Never ACK that stream.
      done(current ? undefined : new Error("Conexão MQTT encerrada antes da confirmação"));
    }, () => {
      // Keep the persistent broker session and withhold PUBACK. MQTT.js reconnects
      // after the transport closes; the broker then redelivers the unacked input.
      // This path never retries an outbound physical command.
      stream.destroy();
      console.error("Persistência MQTT falhou; aguardando reentrega:", packet.topic);
      done(new Error("Mensagem MQTT não confirmada"));
    });
  };

  return client;
}
