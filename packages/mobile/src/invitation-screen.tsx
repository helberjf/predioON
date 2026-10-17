import React, { useEffect, useMemo, useSyncExternalStore } from "react";
import { AppState, KeyboardAvoidingView, Platform, ScrollView, Text } from "react-native";
import { createInvitationController, NEW_PASSWORD_MINIMUM, type InvitationRequests } from "./invitation.ts";
import { Button, Card, ErrorMessage, Field, styles } from "./ui.tsx";

const day = (iso: string) => { const at = new Date(iso); return Number.isNaN(at.getTime()) ? "" : at.toLocaleDateString("pt-BR"); };

/** "Tenho um convite": a resident accepts the invitation, then signs in on the ordinary screen. */
export function InvitationScreen({ requests, close }: { requests: InvitationRequests; close(): void }) {
  const controller = useMemo(() => createInvitationController(requests), [requests]);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useEffect(() => {
    controller.setActive(AppState.currentState === "active");
    const subscription = AppState.addEventListener("change", next => controller.setActive(next === "active"));
    return () => {
      subscription.remove();
      controller.setActive(false);
    };
  }, [controller]);
  const preview = state.preview;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
        <Text style={styles.title}>Aceitar convite</Text>
        <Button secondary label="Voltar para entrar" onPress={() => { controller.setActive(false); close(); }} />
        <Card>
          {state.accepted ? (
            <>
              <Text accessibilityLiveRegion="polite" style={styles.text}>Convite aceito. Entre com o e-mail {preview?.email} e a sua senha.</Text>
              <Button label="Ir para a entrada" onPress={() => { controller.setActive(false); close(); }} />
            </>
          ) : !preview ? (
            <>
              <Text style={styles.text}>Informe o código recebido da administração do condomínio.</Text>
              <Field label="Código do convite" value={state.code} onChangeText={controller.setCode}
                autoCapitalize="none" autoCorrect={false} maxLength={64} editable={!state.pending}
                onSubmitEditing={() => void controller.submit()} />
              {state.error && <ErrorMessage message={state.error} />}
              <Button label={state.pending ? "Verificando…" : "Continuar"} disabled={state.pending || !state.code.trim()} onPress={() => void controller.submit()} />
            </>
          ) : (
            <>
              <Text style={styles.text}>Olá, {preview.name}. Você foi convidado para o condomínio {preview.buildingName} com o e-mail {preview.email}.</Text>
              <Text style={styles.muted}>Convite válido até {day(preview.expiresAt)}.</Text>
              {preview.accountExists ? (
                <>
                  <Text style={styles.muted}>Este e-mail já tem conta no Prédio ON; a senha não será alterada.</Text>
                  <Field label="Senha da sua conta" value={state.password} onChangeText={controller.setPassword} secureTextEntry
                    autoCapitalize="none" autoComplete="current-password" textContentType="password" editable={!state.pending}
                    onSubmitEditing={() => void controller.submit()} />
                </>
              ) : (
                <>
                  <Field label="Crie uma senha" value={state.password} onChangeText={controller.setPassword} secureTextEntry
                    autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" editable={!state.pending} />
                  <Text style={styles.muted}>Pelo menos {NEW_PASSWORD_MINIMUM} caracteres.</Text>
                  <Field label="Repita a senha" value={state.confirmation} onChangeText={controller.setConfirmation} secureTextEntry
                    autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" editable={!state.pending}
                    onSubmitEditing={() => void controller.submit()} />
                </>
              )}
              {state.error && <ErrorMessage message={state.error} />}
              <Button label={state.pending ? "Enviando…" : "Aceitar convite"} disabled={state.pending || !state.password} onPress={() => void controller.submit()} />
              <Button secondary label="Usar outro código" disabled={state.pending} onPress={controller.restart} />
            </>
          )}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
