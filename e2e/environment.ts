/** Dedicated loopback ports keep the browser suite separate from ordinary development. */
export const API_URL = "http://127.0.0.1:3100";
export const ADMIN_URL = "http://127.0.0.1:5273";
export const BUILDING_URL = "http://127.0.0.1:5274";
export const RESIDENT_URL = "http://127.0.0.1:5275";
export const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? "predioon123";
