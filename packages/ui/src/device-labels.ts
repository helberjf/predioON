import { SENSOR_DEVICE_TYPES } from "@predioon/shared";
import { readableCode } from "./labels.js";

const DEVICE_TYPES: Record<string, string> = {
  ...Object.fromEntries(SENSOR_DEVICE_TYPES.map(type => [type.value, type.label])),
  GATE_CONTROLLER: "Controlador de portão",
  PARKING_SENSOR: "Sensor de vagas",
};
export const deviceTypeLabel = (type: string): string => DEVICE_TYPES[type] ?? readableCode(type);
