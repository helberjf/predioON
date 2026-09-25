import { accessTopic } from "@predioon/shared";
export type AccessPublisher = {
  connected: boolean;
  options: { queueQoSZero?: boolean };
  publish: (topic: string, payload: string, options: { qos: 0; retain: false }, done: (error?: Error) => void) => unknown;
};
type Command = { id: string; buildingId: string; gatewayId: string; gateId: string; deviceId: string; expiresAt: Date; createdAt: Date };
export async function publishAccessCommand(client: AccessPublisher, command: Command, connectedSince: Date, now = new Date()): Promise<void> {
  if (!client.connected) throw new Error("Conexão MQTT indisponível");
  if (client.options.queueQoSZero !== false) throw new Error("Fila MQTT precisa estar desabilitada");
  if (command.expiresAt <= now) throw new Error("Comando expirado");
  if (command.createdAt < connectedSince) throw new Error("Comando anterior à conexão; reenvio bloqueado");
  const payload = JSON.stringify({ commandId: command.id, buildingId: command.buildingId, gatewayId: command.gatewayId, gateId: command.gateId, deviceId: command.deviceId, action: "OPEN", issuedAt: command.createdAt.toISOString(), expiresAt: command.expiresAt.toISOString() });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Tempo de envio esgotado")), Math.max(1, Math.min(2000, command.expiresAt.getTime() - now.getTime())));
    client.publish(accessTopic(command.buildingId, command.gatewayId, command.gateId, "command"), payload, { qos: 0, retain: false }, error => {
      clearTimeout(timeout);
      if (error) reject(error); else resolve();
    });
  });
}
