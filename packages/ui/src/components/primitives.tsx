import type { ComponentType, ReactNode } from "react";
import { Building2, Inbox, LoaderCircle } from "lucide-react";
import { cls } from "../format.js";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  danger: "border-rose-200 bg-rose-50 text-rose-700",
  info: "border-sky-200 bg-sky-50 text-sky-700",
};

/** Maps backend enums (status, severity) to a colour, in one place for all three panels. */
export function toneFor(value: string): Tone {
  if (["ONLINE", "RESOLVED", "CONFIRMED", "DONE", "GOOD", "ATIVO"].includes(value)) return "success";
  if (["CRITICAL", "HIGH", "OFFLINE", "ERROR", "OPEN", "REJECTED", "BAD"].includes(value)) return "danger";
  if (["MEDIUM", "PENDING", "PROVISIONING", "IN_ANALYSIS", "IN_PROGRESS", "ACKNOWLEDGED", "UNCERTAIN"].includes(value))
    return "warning";
  if (["LOW", "INFO"].includes(value)) return "info";
  return "neutral";
}

export function Badge({ children, tone }: { children: ReactNode; tone?: Tone }) {
  const resolved = tone ?? toneFor(String(children));
  return (
    <span className={cls("inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold", TONE_CLASSES[resolved])}>
      {typeof children === "string" ? STATUS_LABELS[children] ?? children : children}
    </span>
  );
}

const STATUS_LABELS: Record<string, string> = {
  ONLINE: "Online", OFFLINE: "Offline", PROVISIONING: "Em configuração", UNKNOWN: "Sem informação",
  OPEN: "Aberto", ACKNOWLEDGED: "Em atendimento", RESOLVED: "Resolvido", CRITICAL: "Crítico",
  HIGH: "Alto", MEDIUM: "Médio", LOW: "Baixo", INFO: "Informativo", PENDING: "Pendente",
  CONFIRMED: "Confirmada", REJECTED: "Recusada", CANCELLED: "Cancelado", DONE: "Concluído",
  IN_PROGRESS: "Em andamento", IN_ANALYSIS: "Em análise", GOOD: "Validada", BAD: "Inválida",
  UNCERTAIN: "Incerta", ATIVO: "Ativo", INATIVO: "Inativo", ERROR: "Erro",
};

export function Brand({ dark = false, compact = false }: { dark?: boolean; compact?: boolean }) {
  return <div className="flex items-center gap-2.5">
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500"><Building2 size={25} strokeWidth={2} /></span>
    <span className={cls("text-xl font-bold tracking-tight", dark ? "text-white" : "text-slate-900")}>
      Prédio <span className="text-emerald-500">ON</span>
      {!compact && <span className={cls("mt-0.5 block text-[9px] font-medium uppercase tracking-[0.18em]", dark ? "text-slate-400" : "text-slate-500")}>Seu condomínio conectado</span>}
    </span>
  </div>;
}

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  full?: boolean;
};

const BUTTON_VARIANTS = {
  primary: "bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300",
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
  ghost: "text-slate-600 hover:bg-slate-100",
  danger: "bg-rose-600 text-white hover:bg-rose-700",
} as const;

export function Button({ children, onClick, variant = "primary", type = "button", disabled, full }: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cls(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition",
        "disabled:cursor-not-allowed disabled:opacity-60",
        BUTTON_VARIANTS[variant],
        full && "w-full",
      )}
    >
      {children}
    </button>
  );
}

export function Card({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cls("min-w-0 rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_8px_rgba(15,23,42,0.025)]", className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            {title && <h2 className="font-semibold text-slate-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function StatTile({
  label,
  value,
  detail,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  tone?: Tone;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_2px_8px_rgba(15,23,42,0.025)]">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        {Icon && <span className={cls("rounded-xl border p-2.5", TONE_CLASSES[tone])}><Icon size={19} /></span>}
      </div>
      <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{value}</p>
      {detail && <p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p>}
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <div className="flex flex-col items-center gap-3 px-3 py-8 text-center"><Inbox size={24} className="text-slate-300" /><p className="max-w-sm text-sm leading-6 text-slate-500">{text}</p></div>;
}

export function LoadingState({ text = "Carregando informações…" }: { text?: string }) {
  return <p role="status" className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500"><LoaderCircle size={18} className="animate-spin" />{text}</p>;
}

export function ResourceFeedback({ resource, emptyText }: {
  resource: { error: string | null; loading: boolean; reload: () => void }; emptyText: string;
}) {
  if (resource.loading) return <LoadingState />;
  if (resource.error) return <div className="space-y-3"><ErrorBanner message={resource.error} /><Button variant="secondary" onClick={resource.reload}>Tentar novamente</Button></div>;
  return <EmptyState text={emptyText} />;
}

export function PageHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-[28px]">{title}</h1>{description && <p className="mt-1.5 text-sm leading-6 text-slate-500">{description}</p>}</div>{action}</div>;
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div role="alert" className="flex items-start justify-between gap-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      <span>{message}</span>
      {onDismiss && (
        <button aria-label="Fechar mensagem" onClick={onDismiss} className="font-bold text-rose-500">
          ×
        </button>
      )}
    </div>
  );
}
