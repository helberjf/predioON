import type { ComponentType, ReactNode } from "react";
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
      {children}
    </span>
  );
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
    <section className={cls("rounded-2xl border border-slate-200 bg-white shadow-sm", className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
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
    <div className={cls("rounded-2xl border p-5", TONE_CLASSES[tone])}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium opacity-80">{label}</p>
        {Icon && <Icon size={20} className="opacity-70" />}
      </div>
      <p className="mt-3 text-3xl font-bold tracking-tight">{value}</p>
      {detail && <p className="mt-1 text-xs opacity-70">{detail}</p>}
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <p className="py-10 text-center text-sm text-slate-400">{text}</p>;
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      <span>{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="font-bold text-rose-500">
          ×
        </button>
      )}
    </div>
  );
}
