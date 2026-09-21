import { Field, Select } from "@predioon/ui";
import type { SensorChoice } from "@predioon/ui";

export function SensorPicker({ label = "Sensor", value, options, onChange }: { label?: string; value: string; options: SensorChoice[]; onChange: (value: string) => void }) {
  return <Field label={label}><Select value={value} onChange={onChange} options={options.length ? options : [{ value: "", label: "Nenhum sensor disponível" }]} /></Field>;
}
