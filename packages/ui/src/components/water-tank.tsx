import { useId } from "react";
import { formatNumber } from "../format.js";

export function WaterTank({ level, compact = false }: { level: number | null; compact?: boolean }) {
  const id = useId().replace(/:/g, "");
  const fill = level === null ? 0 : Math.max(0, Math.min(100, level));
  const top = 153 - fill * 1.13;
  return <div className={`flex items-center justify-center gap-3 ${compact ? "py-1" : "py-3"}`}>
    <svg role="img" aria-label={level === null ? "Reservatório sem leitura disponível" : `Nível medido: ${formatNumber(level)} por cento`} viewBox="0 0 120 190" className={`${compact ? "h-36 w-24" : "h-44 w-28"} shrink-0`}>
      <defs><linearGradient id={`water-${id}`} x1="0" y1="0" x2="1" y2="0"><stop stopColor="#1687d7"/><stop offset="0.5" stopColor="#36a2ea"/><stop offset="1" stopColor="#1479c2"/></linearGradient><clipPath id={`tank-${id}`}><path d="M19 37 A41 10 0 0 1 101 37 L101 151 A41 10 0 0 1 19 151Z"/></clipPath></defs>
      <path d="M31 161v16M90 161v16M60 16v9" stroke="#cdd5db" strokeWidth="6" strokeLinecap="round"/>
      <path d="M16 35A44 13 0 0 1 104 35V154A44 13 0 0 1 16 154Z" fill="#f5f8fa" stroke="#d2d9df" strokeWidth="6"/>
      {level !== null && <g clipPath={`url(#tank-${id})`}><rect x="18" y={top} width="85" height="150" fill={`url(#water-${id})`}/><ellipse cx="60" cy={top} rx="42" ry="9" fill="#67bef5"/></g>}
      <ellipse cx="60" cy="35" rx="44" ry="12" fill="white" fillOpacity="0.55" stroke="#d2d9df" strokeWidth="5"/>
      <path d="M18 37V153M102 37V153" stroke="#cbd4db" strokeWidth="4"/>
      <path d="M24 48V144" stroke="white" strokeOpacity="0.35" strokeWidth="5"/>
    </svg>
    <div className="min-w-0"><p className="text-[30px] font-bold leading-tight tracking-tight text-[#142f50]">{level === null ? "—" : `${formatNumber(level, 0)}%`}</p><p className="mt-1 text-xs leading-4 text-slate-500">{level === null ? "Aguardando informação" : "Nível do reservatório"}</p></div>
  </div>;
}
