import { createContext, useContext, useId, type InputHTMLAttributes, type ReactNode } from "react";

const FieldContext = createContext<{ labelId: string; hintId?: string } | null>(null);

function useFieldAttributes() {
  const field = useContext(FieldContext);
  return { "aria-labelledby": field?.labelId, "aria-describedby": field?.hintId };
}

type FieldProps = { label: string; hint?: string; children: ReactNode };

export function Field({ label, hint, children }: FieldProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <label className="block">
      <span id={labelId} className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      <FieldContext.Provider value={{ labelId, hintId }}>{children}</FieldContext.Provider>
      {hint && <span id={hintId} className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

const CONTROL =
  "w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 " +
  "outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "password" | "number" | "datetime-local" | "date" | "time";
  placeholder?: string;
  required?: boolean;
};

export function Input({ value, onChange, type = "text", placeholder, required, ...attributes }: InputProps) {
  return (
    <input
      {...useFieldAttributes()}
      {...attributes}
      className={CONTROL}
      type={type}
      value={value}
      placeholder={placeholder}
      required={required}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function TextArea({
  value,
  onChange,
  rows = 4,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <textarea
      {...useFieldAttributes()}
      className={CONTROL}
      rows={rows}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  disabled,
  required,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  disabled?: boolean;
  required?: boolean;
}) {
  return (
    <select {...useFieldAttributes()} className={CONTROL} value={value} disabled={disabled} required={required} onChange={(event) => onChange(event.target.value as T)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
