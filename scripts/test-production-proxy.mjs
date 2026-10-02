import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const base = resolve(root, ".local");
await mkdir(base, { recursive: true });
const directory = await mkdtemp(join(base, "proxy-verification-"));
const suffix = `${process.pid}-${Date.now()}`;
const network = `predioon-proxy-check-${suffix}`, api = `${network}-api`, web = `${network}-web`;
const image = process.env.PROXY_TEST_NODE_IMAGE ?? "node:24-alpine";
const containers = []; let networkCreated = false;
const docker = async (...args) => (await execute("docker", args, { cwd: root, timeout: 120_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true })).stdout;

try {
  // All values are synthetic. Never load a user's production .env or emit a
  // rendered Compose document, which would include its environment values.
  const environment = Object.fromEntries(["POSTGRES_PASSWORD", "APP_DB_PASSWORD", "IDENTITY_DB_PASSWORD", "BROKER_AUTH_DB_PASSWORD", "JWT_ACTIVE_KID", "JWT_PRIVATE_KEY", "JWT_PUBLIC_KEYS", "MQTT_AUTH_SECRET", "MQTT_INGEST_PASSWORD", "EMQX_DASHBOARD_PASSWORD", "AUTH_RATE_LIMIT_KEY"].map(key => [key, "synthetic-proxy-check-value-32-bytes-plus"]));
  Object.assign(environment, { DOMAIN: "example.invalid", ACME_EMAIL: "proxy@example.invalid", MQTT_CERTS_DIR: directory });
  const composePath = join(directory, "compose.env");
  await writeFile(composePath, Object.entries(environment).map(([key, value]) => `${key}=${value}`).join("\n"));
  const cleanEnvironment = { ...process.env };
  for (const key of [...Object.keys(environment), "PROXY_NETWORK_CIDR", "PROXY_IPV4_ADDRESS", "COMPOSE_FILE"]) delete cleanEnvironment[key];
  const { stdout } = await execute("docker", ["compose", "-f", "infrastructure/docker-compose.prod.yml", "--env-file", composePath, "config", "--format", "json"], { cwd: root, env: cleanEnvironment, timeout: 30_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  const compose = JSON.parse(stdout);
  assert.equal(compose.services.api.environment.TRUST_PROXY_CIDRS, "172.30.250.2/32");
  assert.equal(compose.services.api.ports, undefined);
  assert.deepEqual(Object.keys(compose.services.web.networks), ["edge_proxy"]);
  assert.equal(compose.services.web.networks.edge_proxy.ipv4_address, "172.30.250.2");
  assert.equal(compose.networks.edge_proxy.ipam.config[0].subnet, "172.30.250.0/29");
  for (const service of ["db", "emqx", "ingest"]) assert.equal(compose.services[service].networks.edge_proxy, undefined);

  const source = await readFile(join(root, "infrastructure/Caddyfile"), "utf8");
  const start = source.indexOf("api.{$DOMAIN} {");
  const end = source.indexOf("# ---------------------------------------------------------------- painéis", start);
  assert.ok(start > 0 && end > start);
  // Exercise the exact production API handlers without requesting public TLS
  // certificates. The verification listener is reachable only in this network.
  await writeFile(join(directory, "Caddyfile"), "{\n auto_https off\n}\n" + source.slice(start, end).replace("api.{$DOMAIN}", ":8080"));
  await writeFile(join(directory, "echo.mjs"), `import http from 'node:http';http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({headers:req.headers,peer:req.socket.remoteAddress}));}).listen(3000,'0.0.0.0');`);
  await writeFile(join(directory, "verify.mjs"), `
import assert from 'node:assert/strict';
let ready=false;
for(let i=0;i<50;i++){try{const response=await fetch('http://web:8080/health');if(response.ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,200));}
assert.ok(ready,'isolated proxy must become ready');
for(const path of ['/auth/login','/events/live']){
 const response=await fetch('http://web:8080'+path,{headers:{'X-Forwarded-For':'203.0.113.8, 198.51.100.8',Forwarded:'for=192.0.2.8'}});
 assert.equal(response.status,200);const body=await response.json();
 assert.equal(body.headers['x-forwarded-for'],'172.30.251.4');
 assert.equal(body.headers.forwarded,undefined);assert.equal(body.peer,'172.30.251.2');
}
assert.equal((await fetch('http://web:8080/internal/mqtt/authn')).status,404);
console.log('Caddy: forged forwarding headers replaced on API/SSE; internal routes blocked.');
`);
  await docker("network", "create", "--subnet", "172.30.251.0/29", network); networkCreated = true;
  await docker("run", "-d", "--name", api, "--network", network, "--network-alias", "api", "--ip", "172.30.251.3", "--mount", `type=bind,source=${directory},target=/verification,readonly`, "--entrypoint", "node", image, "/verification/echo.mjs"); containers.push(api);
  await docker("run", "-d", "--name", web, "--network", network, "--network-alias", "web", "--ip", "172.30.251.2", "--mount", `type=bind,source=${directory},target=/verification,readonly`, "caddy:2-alpine", "caddy", "run", "--config", "/verification/Caddyfile"); containers.push(web);
  const result = await docker("run", "--rm", "--network", network, "--ip", "172.30.251.4", "--mount", `type=bind,source=${directory},target=/verification,readonly`, "--entrypoint", "node", image, "/verification/verify.mjs");
  console.log(result.trim());
  console.log("Compose: only the dedicated Caddy address is trusted; API has no public port.");
} finally {
  for (const container of containers.reverse()) await docker("rm", "-f", container);
  if (networkCreated) await docker("network", "rm", network);
}
