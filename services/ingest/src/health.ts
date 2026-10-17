import { healthyHeartbeat, heartbeatPath } from "./heartbeat.js";
process.exitCode = await healthyHeartbeat(heartbeatPath()) ? 0 : 1;
