import { heartbeatPath, healthyHeartbeat } from "./heartbeat.js";
process.exitCode = await healthyHeartbeat(heartbeatPath()) ? 0 : 1;
