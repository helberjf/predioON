import mqtt from "mqtt";
import { GATEWAY_STATUS_TOPIC, TELEMETRY_TOPIC } from "@predioon/shared";
import { config } from "./config.js";

export type MessageHandler = (topic: string, payload: Buffer) => Promise<void>;

export function connectIngest(onMessage: MessageHandler): mqtt.MqttClient {
  const client = mqtt.connect(config.MQTT_URL, {
    username: config.MQTT_USERNAME,
    password: config.MQTT_PASSWORD,
    clientId: config.MQTT_CLIENT_ID,
    clean: false, // durable session: messages published while ingest is down are redelivered
    reconnectPeriod: 2000,
  });

  client.on("connect", () => {
    console.log(`MQTT conectado em ${config.MQTT_URL}`);
    client.subscribe([TELEMETRY_TOPIC, GATEWAY_STATUS_TOPIC], { qos: 1 }, (error) => {
      if (error) console.error("Falha ao assinar tópicos:", error);
      else console.log(`Assinando ${TELEMETRY_TOPIC} e ${GATEWAY_STATUS_TOPIC}`);
    });
  });

  client.on("reconnect", () => console.warn("MQTT reconectando..."));
  client.on("error", (error) => console.error("Erro MQTT:", error.message));

  client.on("message", (topic, payload) => {
    // One bad message must never take the service down.
    void onMessage(topic, payload).catch((error) => {
      console.error("Mensagem MQTT descartada:", topic, error);
    });
  });

  return client;
}
