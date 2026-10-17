import React, { useEffect, useMemo, useSyncExternalStore } from "react";
import { AppState, KeyboardAvoidingView, Platform, ScrollView, Text } from "react-native";
import { createPasswordRecoveryController, type PasswordRecoveryRequest } from "./password-recovery.ts";
import { Button, Card, ErrorMessage, Field, styles } from "./ui.tsx";

export function PasswordRecoveryScreen({ request, close }: {
  request: PasswordRecoveryRequest;
  close(): void;
}) {
  const controller = useMemo(() => createPasswordRecoveryController(request), [request]);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useEffect(() => {
    controller.setActive(AppState.currentState === "active");
    const subscription = AppState.addEventListener("change", next => controller.setActive(next === "active"));
    return () => {
      subscription.remove();
      controller.setActive(false);
    };
  }, [controller]);
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
        <Text style={styles.title}>Recuperar senha</Text>
        <Button secondary label="Voltar para entrar" onPress={() => { controller.setActive(false); close(); }} />
        <Card>
          <Text style={styles.text}>Informe o e-mail da sua conta para solicitar um link de recuperação.</Text>
          <Text style={styles.muted}>Abra o link do e-mail no portal para criar uma nova senha. Depois, volte ao aplicativo para entrar.</Text>
          {state.requested ? (
            <Text accessibilityLiveRegion="polite" style={styles.text}>
              Se este e-mail tiver uma conta, você receberá um link para criar uma nova senha. Ele vale por 60 minutos. Confira também a caixa de spam.
            </Text>
          ) : (
            <>
              <Field label="E-mail" value={state.email} onChangeText={controller.setEmail}
                autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
                autoComplete="email" textContentType="emailAddress" maxLength={254}
                editable={!state.pending} onSubmitEditing={() => void controller.submit()} />
              {state.error && <ErrorMessage message={state.error} />}
              <Button label={state.pending ? "Solicitando…" : "Enviar link de recuperação"}
                disabled={state.pending || !state.email.trim()} onPress={() => void controller.submit()} />
            </>
          )}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
