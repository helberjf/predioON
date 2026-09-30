import { z } from "zod";

export const PropertyTypeSchema = z.enum(["CONDOMINIUM", "HOUSE", "COMMERCIAL"]);
export type PropertyType = z.infer<typeof PropertyTypeSchema>;

export const PROPERTY_TYPES = [
  { value: "CONDOMINIUM", label: "Condomínio" },
  { value: "HOUSE", label: "Casa" },
  { value: "COMMERCIAL", label: "Imóvel comercial" },
] as const;

export const IanaTimezoneSchema = z.string().trim().min(1).max(60).refine((timezone) => {
  // Intl also supports numeric offsets on some runtimes; require a named IANA zone.
  if (!/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(timezone)) return false;
  try { new Intl.DateTimeFormat("pt-BR", { timeZone: timezone }).format(); return true; }
  catch { return false; }
}, "Informe um fuso IANA válido, como America/Sao_Paulo");

const PropertyFieldsSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(2).max(120),
  code: z.string().min(2).max(30),
  propertyType: PropertyTypeSchema,
  timezone: IanaTimezoneSchema,
  address: z.record(z.string(), z.unknown()).optional(),
});

export const CreatePropertySchema = PropertyFieldsSchema.extend({
  propertyType: PropertyTypeSchema.default("CONDOMINIUM"),
  timezone: IanaTimezoneSchema.default("America/Sao_Paulo"),
});

// Build PATCH from fields without defaults: an unrelated edit must preserve both settings.
export const UpdatePropertySchema = PropertyFieldsSchema.omit({ organizationId: true }).partial()
  .extend({ active: z.boolean().optional() });
