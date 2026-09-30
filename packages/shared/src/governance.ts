import { z } from "zod";

export const TicketPrioritySchema = z.enum(["LOW", "NORMAL", "HIGH"]);
export const TICKET_PRIORITIES = [{ value: "LOW", label: "Baixa" }, { value: "NORMAL", label: "Média" }, { value: "HIGH", label: "Alta" }];
export const TICKET_STATUSES = [{ value: "OPEN", label: "Aberto" }, { value: "IN_ANALYSIS", label: "Em análise" }, { value: "IN_PROGRESS", label: "Em execução" }, { value: "DONE", label: "Concluído" }, { value: "CANCELLED", label: "Cancelado" }];
export function duplicateTopic(category: string, title: string, location: string | null) {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return JSON.stringify([category, title, location ?? ""].map(normalize));
}
export const TicketCreateSchema = z.object({
  buildingId: z.string().min(1), category: z.string().trim().min(2).max(60), title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(3).max(4000), location: z.string().trim().max(160).optional(), unit: z.string().trim().max(40).optional(),
  priority: TicketPrioritySchema.default("NORMAL"),
}).strict();

const cents = z.number().int().min(0).max(100_000_000_000);
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T12:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Data inválida");
const receipt = z.string().trim().url().max(2000).refine(value => {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
}, "Use um link HTTPS sem credenciais");
export const FinancialEntrySchema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]), category: z.string().trim().min(2).max(80), description: z.string().trim().min(3).max(500),
  amountCents: cents.refine(value => value > 0, "Informe um valor maior que zero"), date: calendarDate, receiptUrl: receipt.nullable(),
}).strict();
export const FinancialContentSchema = z.object({
  month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/), title: z.string().trim().min(3).max(160),
  openingBalanceCents: z.number().int().min(-100_000_000_000).max(100_000_000_000),
  summary: z.string().trim().min(3).max(4000), entries: z.array(FinancialEntrySchema).max(500),
}).strict().refine(value => value.entries.every(entry => entry.date.startsWith(value.month)), { message: "As datas dos lançamentos devem pertencer ao mês informado", path: ["entries"] });
export type FinancialEntry = z.infer<typeof FinancialEntrySchema>;
export type FinancialContent = z.infer<typeof FinancialContentSchema>;
export function financialTotals(content: Pick<FinancialContent, "openingBalanceCents" | "entries">) {
  const incomeCents = content.entries.filter(e => e.type === "INCOME").reduce((sum, e) => sum + e.amountCents, 0);
  const expenseCents = content.entries.filter(e => e.type === "EXPENSE").reduce((sum, e) => sum + e.amountCents, 0);
  return { incomeCents, expenseCents, closingBalanceCents: content.openingBalanceCents + incomeCents - expenseCents };
}
export type FinancialReport = FinancialContent & {
  id: string; buildingId: string; revision: number; version: number; createdAt: string; updatedAt: string;
  publishedAt: string | null; publishedBy: string | null; totals: ReturnType<typeof financialTotals>;
};
