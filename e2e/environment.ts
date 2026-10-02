/** Dedicated loopback ports keep the browser suite separate from ordinary development. */
const offset = process.env.E2E_PORT_OFFSET ?? "0";
if (!/^\d{1,4}$/.test(offset) || Number(offset) > 9999) throw new Error("E2E_PORT_OFFSET deve ser um inteiro entre 0 e 9999.");
export const E2E_PORT_OFFSET = Number(offset);
export const API_URL = `http://127.0.0.1:${3100 + E2E_PORT_OFFSET}`;
export const ADMIN_URL = `http://127.0.0.1:${5273 + E2E_PORT_OFFSET}`;
export const BUILDING_URL = `http://127.0.0.1:${5274 + E2E_PORT_OFFSET}`;
export const RESIDENT_URL = `http://127.0.0.1:${5275 + E2E_PORT_OFFSET}`;
export const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? "predioon123";
