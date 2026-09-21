import { Droplets } from "lucide-react";
import { formatNumber } from "../format.js";

export function WaterTank({ level, compact = false }: { level: number | null; compact?: boolean }) {
  const fill = level === null ? 0 : Math.max(0, Math.min(100, level));
  return <div className={`flex items-center justify-center gap-7 ${compact ? "py-2" : "py-5"}`}>
    <div role="img" aria-label={level === null ? "Reservatório sem leitura disponível" : `Nível medido: ${formatNumber(level)} por cento`} className={`relative overflow-hidden rounded-b-[24px] rounded-t-[14px] border-[3px] border-slate-300 bg-slate-50 shadow-inner ${compact ? "h-32 w-32" : "h-44 w-44"}`}>
      {level !== null && <div className="absolute inset-x-0 bottom-0 border-t-4 border-sky-300 bg-gradient-to-b from-sky-400 to-sky-600 transition-all duration-700" style={{ height: `${fill}%` }} />}
      <div className="absolute inset-x-0 top-1/4 border-t border-slate-300/40" /><div className="absolute inset-x-0 top-1/2 border-t border-slate-300/40" /><div className="absolute inset-x-0 top-3/4 border-t border-slate-300/40" />
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-sky-600 shadow-sm"><Droplets size={23} /></span></div>
      <div className="absolute inset-y-3 left-3 w-2 rounded-full bg-white/25" />
    </div>
    <div><p className="text-xs font-medium uppercase tracking-wider text-slate-400">Nível medido</p><p className="mt-1 text-4xl font-bold tracking-tight text-slate-900">{level === null ? "—" : `${formatNumber(level, 0)}%`}</p><p className="mt-1 text-xs text-slate-500">{level === null ? "Aguardando informação" : "do reservatório"}</p></div>
  </div>;
}
