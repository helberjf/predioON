export * from "./consumption-screen-host.mjs";
import { resetHost as resetConsumptionHost } from "./consumption-screen-host.mjs";

export const alerts = [];
export const Alert = { alert(title, message, buttons) { alerts.push({ title, message, buttons }); } };
export function resetHost(os) { resetConsumptionHost(os); alerts.length = 0; }
