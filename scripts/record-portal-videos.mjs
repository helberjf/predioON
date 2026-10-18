// Grava um vídeo de demonstração de cada portal (administração, síndico, morador) com
// legenda em cada passo, usando as contas e os dados fictícios do seed.
//
//   node scripts/record-portal-videos.mjs <pasta-de-saida> [admin] [building] [resident]
//
// Precisa da API e dos três portais rodando localmente (como no Playwright). Abre uma
// ocorrência de exemplo: use somente contra um banco descartável.
import { createRequire } from "node:module";
import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(process.cwd() + "/package.json");
const { chromium } = require("@playwright/test");

const [out, ...only] = process.argv.slice(2);
if (!out) { console.error("Informe a pasta de saída."); process.exit(64); }
mkdirSync(out, { recursive: true });
const PASSWORD = process.env.SEED_PASSWORD ?? "predioon123";
const PAUSE = Number(process.env.VIDEO_PAUSE_MS ?? 2200);
const portals = {
  admin: { origin: process.env.ADMIN_URL ?? "http://localhost:5173", email: "admin@predioon.local", viewport: { width: 1280, height: 720 }, title: "Portal da administração" },
  building: { origin: process.env.BUILDING_URL ?? "http://localhost:5174", email: "sindico@predioon.local", viewport: { width: 1280, height: 720 }, title: "Portal do síndico" },
  resident: { origin: process.env.RESIDENT_URL ?? "http://localhost:5175", email: "morador@predioon.local", viewport: { width: 390, height: 844 }, title: "Portal do morador" },
};

/** A caption bar drawn by the page itself, so it is part of the recording. */
const CAPTION = () => {
  window.__caption = text => {
    let bar = document.getElementById("__demo_caption");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "__demo_caption";
      Object.assign(bar.style, { position: "fixed", left: "50%", bottom: "18px", transform: "translateX(-50%)", zIndex: 2147483647,
        background: "rgba(15,35,58,.92)", color: "#fff", font: "600 15px/1.35 system-ui, sans-serif", padding: "10px 16px",
        borderRadius: "12px", maxWidth: "92vw", textAlign: "center", boxShadow: "0 6px 20px rgba(0,0,0,.25)", pointerEvents: "none" });
      document.body.appendChild(bar);
    }
    bar.textContent = text;
  };
};

async function record(key, tour) {
  const portal = portals[key];
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: portal.viewport, deviceScaleFactor: 1, recordVideo: { dir: out, size: portal.viewport } });
  await context.addInitScript(CAPTION);
  const page = await context.newPage();
  const caption = async text => { await page.evaluate(value => window.__caption?.(value), text).catch(() => {}); await page.waitForTimeout(PAUSE); };
  const open = async (label, text) => {
    const link = page.getByRole("link", { name: label, exact: true }).first();
    if (!await link.count()) { console.log(`${key}: sem "${label}" nesta conta, passo omitido`); return false; }
    await link.click();
    await page.waitForLoadState("networkidle").catch(() => {});
    await caption(text);
    return true;
  };
  try {
    await page.goto(portal.origin, { waitUntil: "domcontentloaded" });
    await caption(`${portal.title} — entrada com conta de demonstração (dados fictícios)`);
    await page.getByLabel("E-mail", { exact: true }).fill(portal.email);
    await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.getByLabel("Senha", { exact: true }).waitFor({ state: "detached" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await tour({ page, caption, open });
  } finally {
    const video = page.video();
    await context.close();
    await browser.close();
    if (video) renameSync(await video.path(), join(out, `${key}.webm`));
  }
  console.log(`${key}: ${join(out, `${key}.webm`)}`);
}

const tours = {
  async admin({ page, caption, open }) {
    await caption("Visão geral: condomínios, gateways, alertas e sensores de toda a carteira");
    await page.getByText("Serviços da plataforma", { exact: true }).scrollIntoViewIfNeeded().catch(() => {});
    await caption("Serviços da plataforma: leituras recebidas, avisos, comandos e tarefas agendadas");
    await open("Condomínios", "Condomínios da carteira");
    await open("Clientes", "Clientes (organizações) e seus condomínios");
    await open("Comunicação", "Gateways de comunicação de cada condomínio");
    await open("Equipamentos", "Sensores e equipamentos cadastrados");
    await open("Funcionalidades", "Funcionalidades ligadas e desligadas por condomínio");
    await open("Usuários", "Contas da plataforma");
    await open("Acesso de suporte", "Acesso temporário de suporte: só com concessão explícita e prazo");
    await open("Histórico de atividades", "Auditoria das ações da plataforma");
    await open("Minhas sessões", "Sessões abertas e verificação em duas etapas");
  },
  async building({ page, caption, open }) {
    await caption("Painel do condomínio: água, energia, sensores e alertas");
    await open("Água e reservatórios", "Nível dos reservatórios e consumo de água");
    await open("Energia e fases", "Energia e tensão das fases");
    await open("Consumo e análise", "Consumo diário e limites configurados");
    await open("Alertas", "Alertas abertos, reconhecimento e resolução");
    await open("Ocorrências", "Ocorrências registradas pelos moradores");
    await open("Avisos", "Avisos e comunicados, inclusive programados");
    await open("Áreas comuns", "Áreas comuns e reservas");
    await open("Ordens de serviço", "Ordens de serviço da equipe de manutenção");
    await open("Ativos", "Ativos do condomínio (bombas, caixas d'água, portões)");
    if (await open("Automações", "Automações: abrir ordens por alerta ou em datas programadas")) {
      await page.getByLabel("Quando agir", { exact: true }).selectOption("SCHEDULE").catch(() => {});
      await caption("Manutenção preventiva: a cada N dias, a partir de uma data");
    }
    await open("Unidades e equipes", "Blocos, unidades, equipes, moradores e permissões");
    await open("Transparência e contas", "Transparência: receitas, despesas e prestação de contas");
    await open("Acesso de suporte", "Quem do suporte da plataforma pode ver este condomínio");
  },
  async resident({ page, caption, open }) {
    await caption("Início do morador: avisos, solicitações e atalhos");
    await open("Avisos", "Avisos do condomínio");
    if (await open("Ocorrências", "Ocorrências enviadas à administração")) {
      const title = page.getByLabel("Resumo", { exact: true });
      if (await title.count()) {
        await title.fill("Lâmpada queimada no corredor do 3º andar");
        await caption("Abrindo uma solicitação de exemplo");
      }
    }
    await open("Reservas", "Reserva de áreas comuns com disponibilidade");
    await open("Transparência", "Prestação de contas do condomínio");
    await open("Consumo", "Consumo da unidade, quando liberado pelo síndico");
    await open("Perfil", "Perfil, troca de senha e sessões");
  },
};

for (const key of only.length ? only : Object.keys(tours)) {
  if (!tours[key]) { console.error(`Portal desconhecido: ${key}`); process.exitCode = 64; continue; }
  await record(key, tours[key]);
}
