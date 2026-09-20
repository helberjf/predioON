import type { ReactNode } from "react";
export function Card({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-sm"><h2 className="mb-3 text-sm font-semibold text-slate-300">{title}</h2>{children}</section>;
}
