import React, { type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import type { Resource } from "./resource.ts";

export const colors = {
  ink: "#16324f",
  muted: "#5b6d80",
  green: "#147d65",
  background: "#f1f5f8",
  line: "#dce5eb",
  danger: "#a92738",
};
export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  page: { padding: 20, gap: 16, paddingBottom: 48 },
  card: {
    backgroundColor: "white",
    borderRadius: 16,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.line,
  },
  title: { color: colors.ink, fontSize: 23, fontWeight: "700" },
  subtitle: { color: colors.ink, fontSize: 18, fontWeight: "600" },
  text: { color: colors.ink, fontSize: 15, lineHeight: 23 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  input: {
    borderColor: "#a9b8c5",
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: "white",
    color: colors.ink,
    padding: 12,
    minHeight: 48,
    fontSize: 16,
  },
  button: {
    backgroundColor: colors.green,
    borderRadius: 10,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondary: { backgroundColor: "#e6eef3" },
  buttonText: {
    color: "white",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },
  badge: {
    color: colors.green,
    backgroundColor: "#e2f2eb",
    borderRadius: 7,
    alignSelf: "flex-start",
    paddingHorizontal: 9,
    paddingVertical: 4,
    fontWeight: "600",
    fontSize: 12,
  },
  error: { backgroundColor: "#fff0f1", borderRadius: 10, padding: 14, gap: 10 },
});

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}
export function Button({
  label,
  onPress,
  disabled,
  secondary = false,
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        secondary && styles.secondary,
        disabled && { opacity: 0.5 },
      ]}
    >
      <Text style={[styles.buttonText, secondary && { color: colors.ink }]}>
        {label}
      </Text>
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.muted}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={[
          styles.input,
          props.multiline && { minHeight: 100, textAlignVertical: "top" },
        ]}
        {...props}
      />
    </View>
  );
}
export function ErrorMessage({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.error}>
      <Text style={[styles.text, { color: colors.danger }]}>{message}</Text>
      {retry && <Button label="Tentar novamente" onPress={retry} secondary />}
    </View>
  );
}
export function Feedback<T>({
  resource,
  empty = false,
  emptyMessage = "Nenhum registro disponível.",
}: {
  resource: Resource<T>;
  empty?: boolean;
  emptyMessage?: string;
}) {
  if (resource.error)
    return <ErrorMessage message={resource.error} retry={resource.reload} />;
  if (resource.loading && resource.data === null)
    return (
      <ActivityIndicator color={colors.green} accessibilityLabel="Carregando" />
    );
  if (empty) return <Text style={styles.muted}>{emptyMessage}</Text>;
  return null;
}
export function Refresh({ resource }: { resource: Resource<unknown> }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.muted}>
          {resource.updatedAt
            ? `Atualizado às ${new Date(resource.updatedAt).toLocaleTimeString("pt-BR")}`
            : "Aguardando atualização"}
        </Text>
      </View>
      <Button
        secondary
        label={resource.loading ? "Atualizando…" : "Atualizar"}
        disabled={resource.loading}
        onPress={resource.reload}
      />
    </View>
  );
}
const labels: Record<string, string> = {
  OPEN: "Aberto",
  ACKNOWLEDGED: "Reconhecido",
  RESOLVED: "Resolvido",
  IN_ANALYSIS: "Em análise",
  IN_PROGRESS: "Em execução",
  DONE: "Concluído",
  CANCELLED: "Cancelado",
  PENDING: "Aguardando aprovação",
  CONFIRMED: "Confirmada",
  REJECTED: "Recusada",
  LOW: "Baixa",
  NORMAL: "Média",
  MEDIUM: "Média",
  HIGH: "Alta",
  CRITICAL: "Crítica",
  ONLINE: "Conectado",
  OFFLINE: "Desconectado",
  COMMUNICATION: "Comunicado",
  MAINTENANCE: "Manutenção",
  EVENT: "Evento",
  WASTE_COLLECTION: "Coleta",
  GESTAO: "Gestão",
};
export function label(value: string) {
  return labels[value] ?? value;
}
export function Badge({ value }: { value: string }) {
  return <Text style={styles.badge}>{label(value)}</Text>;
}
export function dateTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("pt-BR")
    : "Data indisponível";
}
export function Pages({
  offset,
  count,
  setOffset,
}: {
  offset: number;
  count: number;
  setOffset(value: number): void;
}) {
  return (
    <View style={styles.row}>
      <Button
        secondary
        label="Anterior"
        disabled={offset === 0}
        onPress={() => setOffset(Math.max(0, offset - 50))}
      />
      <Text style={styles.muted}>Página {offset / 50 + 1}</Text>
      <Button
        secondary
        label="Próxima"
        disabled={count < 50}
        onPress={() => setOffset(offset + 50)}
      />
    </View>
  );
}
