import { Cpu, DoorOpen, Droplets, Flame, Gauge, ShieldCheck, Thermometer, Waves, Zap, type LucideIcon } from "lucide-react";
import type { Device } from "@predioon/ui";

export const DEVICE_STATES = {
  ONLINE: { label: "Online", classes: "border-emerald-200 bg-emerald-50 text-emerald-800", dot: "bg-emerald-500" },
  OFFLINE: { label: "Sem comunicação", classes: "border-rose-200 bg-rose-50 text-rose-800", dot: "bg-rose-500" },
  ERROR: { label: "Erro", classes: "border-rose-200 bg-rose-50 text-rose-800", dot: "bg-rose-500" },
  PROVISIONING: { label: "Em configuração", classes: "border-amber-200 bg-amber-50 text-amber-800", dot: "bg-amber-500" },
  UNKNOWN: { label: "Sem informação", classes: "border-slate-200 bg-slate-50 text-slate-600", dot: "bg-slate-400" },
  DISABLED: { label: "Desativado", classes: "border-slate-200 bg-slate-100 text-slate-600", dot: "bg-slate-400" },
} as const;

export function deviceState(device: Device): keyof typeof DEVICE_STATES {
  if (!device.enabled || device.status === "DISABLED") return "DISABLED";
  return Object.hasOwn(DEVICE_STATES, device.status) ? device.status as keyof typeof DEVICE_STATES : "UNKNOWN";
}

export function deviceIcon(type: string): { icon: LucideIcon; classes: string } {
  if (/WATER|LEAK|SEWAGE|água|vazamento/i.test(type)) return { icon: Droplets, classes: "bg-sky-50 text-sky-700" };
  if (/ENERGY|PHASE|energia|fases/i.test(type)) return { icon: Zap, classes: "bg-amber-50 text-amber-700" };
  if (/GAS|gás/i.test(type)) return { icon: Flame, classes: "bg-orange-50 text-orange-700" };
  if (/SMOKE|incêndio/i.test(type)) return { icon: ShieldCheck, classes: "bg-rose-50 text-rose-700" };
  if (/TEMPERATURE|temperatura/i.test(type)) return { icon: Thermometer, classes: "bg-violet-50 text-violet-700" };
  if (/PUMP|bomba/i.test(type)) return { icon: Waves, classes: "bg-cyan-50 text-cyan-700" };
  if (/GATE|portão/i.test(type)) return { icon: DoorOpen, classes: "bg-slate-100 text-slate-600" };
  if (/METER|medidor/i.test(type)) return { icon: Gauge, classes: "bg-sky-50 text-sky-700" };
  return { icon: Cpu, classes: "bg-slate-100 text-slate-600" };
}

export function normalizeDeviceSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
}
