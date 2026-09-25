import { z } from "zod";

// Only presentation spaces are removed. Protocols, aliases and control characters are rejected.
export const AnyDeskIdSchema = z.string().max(40).regex(/^[0-9 ]+$/, "Informe somente os números do ID AnyDesk")
  .transform(value => value.replaceAll(" ", ""))
  .pipe(z.string().regex(/^[0-9]{9,10}$/, "O ID AnyDesk deve ter 9 ou 10 números"));

export const SupportConfigSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  anydeskId: AnyDeskIdSchema,
  enabled: z.boolean().default(false),
}).strict();
export const SupportRequestSchema = z.object({
  requestId: z.string().uuid(),
  reason: z.string().trim().min(3).max(1000),
}).strict();
export const SupportOutcomeSchema = z.object({
  outcome: z.enum(["RESOLVED", "UNRESOLVED", "NOT_CONNECTED"]),
  notes: z.string().trim().min(3).max(2000),
}).strict();

export function anydeskUri(id: string): string {
  return `anydesk:${AnyDeskIdSchema.parse(id)}`;
}

export type SupportConfigInput = z.input<typeof SupportConfigSchema>;
export type SupportOutcome = z.infer<typeof SupportOutcomeSchema>["outcome"];
export type SupportConfigView = {
  buildingId: string; displayName: string; anydeskId: string; enabled: boolean;
  revision: number; createdAt: string; updatedAt: string;
};
export type SupportRequestView = {
  id: string; requestId: string; buildingId: string; requestedBy: string; requestedByName: string;
  displayName: string; anydeskId: string; configRevision: number; reason: string;
  status: "OPEN" | SupportOutcome; notes: string | null;
  closedBy: string | null; createdAt: string; closedAt: string | null;
};
export type SupportList = { config: SupportConfigView | null; requests: SupportRequestView[] };
export type SupportLaunch = { request: SupportRequestView; launchUri: string };
