import React, { useEffect, useMemo, useSyncExternalStore } from "react";
import { AppState, KeyboardAvoidingView, Platform, ScrollView, Text } from "react-native";
import type { ApiClient } from "@predioon/api-client";
import type { AuthUser } from "@predioon/contracts/auth";
import { createPasswordChangeController } from "./password-change.ts";
import { Button, Card, ErrorMessage, Field, styles } from "./ui.tsx";

export function Account({
  api,
  user,
  close,
}: {
  api: ApiClient;
  user: AuthUser;
  close(): void;
}) {
  const controller = useMemo(
    () => createPasswordChangeController((input) => api.changePassword(input)),
    [api, user.id],
  );
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useEffect(() => {
    controller.setActive(AppState.currentState === "active");
    const subscription = AppState.addEventListener("change", (next) => {
      controller.setActive(next === "active");
    });
    return () => {
      subscription.remove();
      controller.setActive(false);
    };
  }, [controller]);
  const secured = {
    secureTextEntry: true,
    autoCapitalize: "none" as const,
    autoCorrect: false,
    spellCheck: false,
    editable: !state.pending,
  };
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
        <Text style={styles.title}>Minha conta</Text>
        <Button secondary label="Voltar ao aplicativo" onPress={close} />
        <Card>
          <Text style={styles.subtitle}>Trocar minha senha</Text>
          <Text style={styles.text}>
            Confirme sua senha atual e escolha uma nova senha com pelo menos 15 caracteres.
            Espaços são permitidos e preservados.
          </Text>
          <Text style={styles.muted}>
            Após a confirmação, todas as suas sessões serão encerradas. Você precisará entrar novamente com a nova senha.
          </Text>
          <Field
            {...secured}
            label="Senha atual"
            value={state.currentPassword}
            onChangeText={(value) => controller.setField("currentPassword", value)}
            autoComplete="current-password"
            textContentType="password"
          />
          <Field
            {...secured}
            label="Nova senha"
            value={state.newPassword}
            onChangeText={(value) => controller.setField("newPassword", value)}
            autoComplete="new-password"
            textContentType="newPassword"
          />
          <Field
            {...secured}
            label="Confirmar nova senha"
            value={state.confirmation}
            onChangeText={(value) => controller.setField("confirmation", value)}
            autoComplete="new-password"
            textContentType="newPassword"
            onSubmitEditing={() => void controller.submit()}
          />
          {state.error && <ErrorMessage message={state.error} />}
          <Button
            label={state.pending ? "Confirmando troca…" : "Confirmar troca de senha"}
            disabled={state.pending || !state.currentPassword || !state.newPassword || !state.confirmation}
            onPress={() => void controller.submit()}
          />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
