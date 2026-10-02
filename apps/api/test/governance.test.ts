import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import { db, users, organizations, buildings, memberships, auditLogs, occurrences, sqlClient } from "@predioon/db";
import { closeAppDb, withUserContext } from "@predioon/db/runtime";
import { hashPassword } from "../src/auth/passwords.js";
import { startTestServer, login, call } from "./helpers.js";

describe("gestão transparente, chamados e contas", () => {
  const suffix = randomUUID(), org = `gov_org_${suffix}`, building = `gov_b_${suffix}`, other = `gov_other_${suffix}`;
  const ids = ["manager", "resident", "neighbor"].map(role => `gov_${role}_${suffix}`);
  let server: Awaited<ReturnType<typeof startTestServer>>, manager: string, resident: string, neighbor: string;
  const request = (path: string, method = "GET", body?: unknown, token = manager) => call(server.url, path, { method, token, body });
  async function ok(path: string, method = "GET", body?: unknown, token = manager, status = 200) {
    const response = await request(path, method, body, token);
    const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data)); return data;
  }
  const ticket = (token = resident, extra = {}) => ok("/occurrences", "POST", { buildingId: building, category: "ELETRICA", title: "Luz do jardim", description: "Relato particular", location: "Jardim", priority: "NORMAL", ...extra }, token, 201);
  const report = { buildingId: building, month: "2026-09", title: "Contas de setembro", openingBalanceCents: 10000, summary: "Serviços e despesas do mês", entries: [
    { type: "INCOME", category: "Cotas", description: "Arrecadação", amountCents: 20010, date: "2026-09-01", receiptUrl: null },
    { type: "EXPENSE", category: "Manutenção", description: "Troca de lâmpadas", amountCents: 1001, date: "2026-09-02", receiptUrl: "https://example.com/comprovante.pdf" },
  ] };
  before(async () => {
    const passwordHash = await hashPassword("predioon123");
    await db.insert(organizations).values({ id: org, name: "Teste Gestão", slug: org });
    await db.insert(buildings).values([building, other].map(id => ({ id, organizationId: org, name: id, code: id })));
    await db.insert(users).values(ids.map(id => ({ id, name: id, email: `${id}@test.local`, passwordHash })));
    await db.insert(memberships).values(ids.map((userId, index) => ({ userId, buildingId: building, role: index === 0 ? "BUILDING_ADMIN" as const : "RESIDENT" as const })));
    server = await startTestServer();
    [manager, resident, neighbor] = await Promise.all(ids.map(async id => (await login(server.url, `${id}@test.local`)).accessToken));
  });
  after(async () => {
    await server?.close();
    await db.delete(auditLogs).where(inArray(auditLogs.buildingId, [building, other]));
    await db.delete(buildings).where(inArray(buildings.id, [building, other]));
    await db.delete(users).where(inArray(users.id, ids));
    await db.delete(organizations).where(eq(organizations.id, org));
    await closeAppDb(); await sqlClient.end();
  });
  it("morador e síndico abrem com três níveis, recusando um quarto nível", async () => {
    for (const token of [resident, manager]) for (const priority of ["LOW", "NORMAL", "HIGH"]) assert.equal((await ticket(token, { priority })).priority, priority);
    assert.equal((await request("/occurrences", "POST", { buildingId: building, category: "GERAL", title: "Teste", description: "Descrição", priority: "URGENT" }, resident)).status, 400);
  });
  it("alteração de gravidade exige síndico e motivo, registrado para o solicitante", async () => {
    const row = await ticket();
    assert.equal((await request(`/occurrences/${row.id}`, "PATCH", { priority: "HIGH", priorityReason: "Risco constatado" }, resident)).status, 403);
    assert.equal((await request(`/occurrences/${row.id}`, "PATCH", { priority: "HIGH" })).status, 400);
    await ok(`/occurrences/${row.id}`, "PATCH", { priority: "HIGH", priorityReason: "Risco constatado" });
    const detail = await ok(`/occurrences/${row.id}`, "GET", undefined, resident);
    assert.ok(detail.timeline.some((event: any) => event.kind === "PRIORITY_CHANGED" && event.message.includes("Risco constatado")));
    assert.equal((await request(`/occurrences/${row.id}`, "PATCH", { status: "CANCELLED", priority: "LOW", priorityReason: "Ocultar gravidade" }, resident)).status, 403);
  });
  it("filtro Todos inclui concluídos e alteração de gravidade preserva encerramento", async () => {
    const row = await ticket();
    const closed = await ok(`/occurrences/${row.id}`, "PATCH", { status: "DONE" });
    const changed = await ok(`/occurrences/${row.id}`, "PATCH", { priority: "HIGH", priorityReason: "Reclassificação para histórico" });
    assert.equal(changed.closedAt, closed.closedAt);
    const all = await ok(`/occurrences?buildingId=${building}&onlyOpen=false&limit=100`);
    assert.ok(all.items.some((item: any) => item.id === row.id));
    const open = await ok(`/occurrences?buildingId=${building}&onlyOpen=true&limit=100`);
    assert.ok(!open.items.some((item: any) => item.id === row.id));
  });
  it("três assuntos iguais sugerem agrupamento sem publicar relatos de outros moradores", async () => {
    const rows = await Promise.all([ticket(resident, { title: "Portão TRAVADO", location: "Acesso sul" }), ticket(neighbor, { title: "portao travado", location: "acesso sul" }), ticket(manager, { title: "Portão travado!", location: "Acesso Sul" })]);
    const suggestions = await ok(`/occurrences/duplicates?buildingId=${building}`);
    const suggestion = suggestions.items.find((item: any) => item.occurrenceIds.includes(rows[0].id));
    assert.equal(suggestion.count, 3);
    assert.equal((await request(`/occurrences/duplicates?buildingId=${building}`, "GET", undefined, resident)).status, 403);
    assert.equal((await request("/occurrences/group", "POST", { buildingId: building, occurrenceIds: rows.map(r => r.id) }, resident)).status, 403);
    const grouped = await ok("/occurrences/group", "POST", { buildingId: building, occurrenceIds: rows.map(r => r.id) }, manager, 201);
    assert.ok(grouped.groupId);
    await ok(`/occurrences/${rows[0].id}/comments`, "POST", { message: "Equipe agendada para amanhã", applyToGroup: true }, manager, 201);
    await ok(`/occurrences/${rows[0].id}`, "PATCH", { status: "DONE", applyToGroup: true });
    const own = await ok(`/occurrences/${rows[1].id}`, "GET", undefined, neighbor);
    assert.equal(own.status, "DONE"); assert.ok(own.timeline.some((e: any) => e.message === "Equipe agendada para amanhã"));
    assert.ok(!JSON.stringify(own.timeline).includes(rows[0].description));
    assert.equal((await request(`/occurrences/${rows[1].id}`, "GET", undefined, resident)).status, 404);
    assert.equal((await request(`/occurrences/${rows[1].id}/comments`, "POST", { message: "Mensagem privada", applyToGroup: true }, neighbor)).status, 403);
  });
  it("agrupamento rejeita mistura de condomínios, identificadores inválidos e reagrupar", async () => {
    const a = await ticket(), b = await ticket();
    assert.equal((await request("/occurrences/group", "POST", { buildingId: other, occurrenceIds: [a.id, b.id] })).status, 403);
    assert.equal((await request("/occurrences/group", "POST", { buildingId: building, occurrenceIds: [a.id, randomUUID()] })).status, 404);
    await ok("/occurrences/group", "POST", { buildingId: building, occurrenceIds: [a.id, b.id] }, manager, 201);
    assert.equal((await request("/occurrences/group", "POST", { buildingId: building, occurrenceIds: [a.id, b.id] })).status, 409);
    assert.equal((await request("/occurrences/invalid-id", "GET")).status, 400);
  });
  it("rascunho financeiro fica privado, calcula centavos e publicação libera leitura", async () => {
    const row = await ok("/finance", "POST", report, manager, 201);
    assert.equal(row.totals.incomeCents, 20010); assert.equal(row.totals.expenseCents, 1001); assert.equal(row.totals.closingBalanceCents, 29009);
    const hidden = await ok(`/finance?buildingId=${building}`, "GET", undefined, resident);
    assert.ok(!hidden.items.some((item: any) => item.id === row.id));
    const hiddenSql = await withUserContext({ userId: ids[1]!, role: "RESIDENT" }, tx => tx.execute(sql`select id from financial_reports where id = ${row.id}`));
    assert.equal(hiddenSql.length, 0);
    assert.equal((await request(`/finance/${row.id}/publish`, "POST", { version: row.version }, resident)).status, 404);
    const published = await ok(`/finance/${row.id}/publish`, "POST", { version: row.version });
    assert.ok(published.publishedAt);
    const visible = await ok(`/finance?buildingId=${building}`, "GET", undefined, resident);
    assert.ok(visible.items.some((item: any) => item.id === row.id));
    const { buildingId: _, ...content } = report;
    assert.equal((await request(`/finance/${row.id}`, "PUT", { ...content, version: published.version })).status, 409);
    const mutated = await withUserContext({ userId: ids[0]!, role: "BUILDING_ADMIN" }, tx => tx.execute(sql`update financial_reports set summary = 'alterado' where id = ${row.id} returning id`));
    assert.equal(mutated.length, 0);
    const revision = await ok("/finance", "POST", { ...report, summary: "Correção da prestação anterior" }, manager, 201);
    assert.equal(revision.revision, row.revision + 1);
  });
  it("edição de rascunho verifica versão e impede sobrescrita concorrente", async () => {
    const row = await ok("/finance", "POST", { ...report, month: "2026-10", entries: [] }, manager, 201);
    const { buildingId: _, ...content } = report;
    const body = { ...content, month: "2026-10", entries: [], version: row.version };
    const results = await Promise.all([request(`/finance/${row.id}`, "PUT", body), request(`/finance/${row.id}`, "PUT", body)]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  });
  it("financeiro rejeita morador escrevendo, outro prédio, valores e links inválidos", async () => {
    assert.equal((await request("/finance", "POST", report, resident)).status, 403);
    assert.equal((await request(`/finance?buildingId=${other}`)).status, 403);
    for (const amountCents of [-1, 1.5, 1e15]) assert.equal((await request("/finance", "POST", { ...report, entries: [{ ...report.entries[0], amountCents }] })).status, 400);
    for (const receiptUrl of ["javascript:alert(1)", "http://example.com/doc", "https://user:pass@example.com/doc"]) assert.equal((await request("/finance", "POST", { ...report, entries: [{ ...report.entries[0], receiptUrl }] })).status, 400);
    assert.equal((await request("/finance", "POST", { ...report, month: "2026-13" })).status, 400);
    assert.equal((await request("/finance", "POST", { ...report, entries: [{ ...report.entries[0], date: "2026-09-31" }] })).status, 400);
  });
  it("publicação preserva revisões, bloqueia rascunho antigo e não duplica auditoria", async () => {
    const content = { ...report, month: "2026-11", entries: [] };
    const older = await ok("/finance", "POST", content, manager, 201), newer = await ok("/finance", "POST", content, manager, 201);
    assert.equal((await request(`/finance/${newer.id}/publish`, "POST", { version: 999 })).status, 409);
    const published = await ok(`/finance/${newer.id}/publish`, "POST", { version: newer.version });
    const repeated = await ok(`/finance/${newer.id}/publish`, "POST", { version: newer.version });
    assert.equal(published.publishedAt, repeated.publishedAt);
    assert.equal((await request(`/finance/${older.id}/publish`, "POST", { version: older.version })).status, 409);
    assert.equal((await db.select().from(auditLogs).where(eq(auditLogs.resourceId, newer.id))).filter(log => log.action === "FINANCIAL_REPORT_PUBLISHED").length, 1);
  });
  it("agrupamento concorrente grava uma única vinculação e rejeita relato de outro condomínio", async () => {
    const a = await ticket(), b = await ticket();
    const [foreign] = await db.insert(occurrences).values({ buildingId: other, protocol: `cross-${suffix}`, category: "GERAL", title: "Outro prédio", description: "Privado", openedBy: ids[1] }).returning();
    assert.equal((await request("/occurrences/group", "POST", { buildingId: building, occurrenceIds: [a.id, foreign!.id] })).status, 404);
    assert.equal((await request(`/occurrences/${foreign!.id}`, "GET", undefined, resident)).status, 404);
    const body = { buildingId: building, occurrenceIds: [a.id, b.id] };
    const results = await Promise.all([request("/occurrences/group", "POST", body), request("/occurrences/group", "POST", body)]);
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    const detail = await ok(`/occurrences/${a.id}`);
    assert.equal(detail.timeline.filter((e: any) => e.kind === "GROUPED").length, 1);
  });
  it("morador pode cancelar um pedido aberto, mas não alterar o encerramento de um concluído", async () => {
    const open = await ticket();
    assert.equal((await ok(`/occurrences/${open.id}`, "PATCH", { status: "CANCELLED" }, resident)).status, "CANCELLED");
    const closed = await ticket(); await ok(`/occurrences/${closed.id}`, "PATCH", { status: "DONE" });
    assert.equal((await request(`/occurrences/${closed.id}`, "PATCH", { status: "CANCELLED" }, resident)).status, 409);
  });
  it("publica atualizações imediatamente mesmo com relógio da API adiantado e verifica revogação", async t => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 30_000 });
    try {
      const notice = await ok("/notices", "POST", { buildingId: building, category: "GESTAO", title: "Manutenção agendada", body: "Equipe chega amanhã às 9h." }, manager, 201);
      assert.ok((await ok(`/notices?buildingId=${building}`, "GET", undefined, resident)).items.some((item: any) => item.id === notice.id));
    } finally { t.mock.timers.reset(); }
    try {
      await db.update(memberships).set({ active: false }).where(eq(memberships.userId, ids[0]!));
      assert.equal((await request("/finance", "POST", report)).status, 403);
      assert.equal((await request("/occurrences/group", "POST", { buildingId: building, occurrenceIds: [randomUUID(), randomUUID()] })).status, 403);
    } finally { await db.update(memberships).set({ active: true }).where(eq(memberships.userId, ids[0]!)); }
  });
});
