import React, { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import type { ApiClient } from "@predioon/api-client";
import { MFA_REQUIRED_MESSAGE, type AuthUser } from "@predioon/contracts/auth";
import type { Product } from "./scope.ts";
import { Button, Card, colors, ErrorMessage, Field, styles } from "./ui.tsx";
import { PasswordRecoveryScreen } from "./password-recovery-screen.tsx";
import type { PasswordRecoveryRequest } from "./password-recovery.ts";

type LoginProps = {
  api: ApiClient;
  product: Product;
  beginSignIn(): void;
  signedIn(user: AuthUser): void;
  requestPasswordRecovery: PasswordRecoveryRequest;
};

export function Login(props: LoginProps) {
  const [recovering, setRecovering] = useState(false);
  const pendingRef = useRef(false);
  return recovering ? (
    <PasswordRecoveryScreen request={props.requestPasswordRecovery} close={() => setRecovering(false)} />
  ) : (
    <LoginForm {...props} pendingRef={pendingRef} recover={() => {
      if (!pendingRef.current) setRecovering(true);
    }} />
  );
}

function LoginForm({
  api,
  product,
  beginSignIn,
  signedIn,
  pendingRef,
  recover,
}: LoginProps & { pendingRef: React.MutableRefObject<boolean>; recover(): void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Asked for only after the server says this account uses two-step verification.
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function login() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    beginSignIn();
    setPending(true);
    setError(null);
    try {
      const session = await api.login(email.trim(), password, needsCode ? code.trim() : undefined);
      setPassword("");
      setCode("");
      signedIn(session.user);
    } catch (cause) {
      if (cause instanceof Error && cause.message === MFA_REQUIRED_MESSAGE && !needsCode) {
        setNeedsCode(true);
        return;
      }
      setError(
        cause instanceof Error ? cause.message : "Não foi possível entrar.",
      );
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.page}
      >
        <View style={{ paddingVertical: 28, gap: 12 }}>
          <Text
            style={{
              color: colors.green,
              fontSize: 15,
              fontWeight: "700",
              letterSpacing: 2,
            }}
          >
            PRÉDIO ON
          </Text>
          <Text style={styles.title}>
            {product === "resident"
              ? "Seu condomínio, por perto."
              : "A operação, em suas mãos."}
          </Text>
          <Text style={styles.text}>
            {product === "resident"
              ? "Acompanhe os avisos, envie solicitações e reserve espaços."
              : "Acompanhe leituras, alertas e a rotina da equipe."}
          </Text>
        </View>
        <Card>
          <Text style={styles.subtitle}>Entrar</Text>
          <Field
            label="E-mail"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="username"
            editable={!pending}
          />
          <Field
            label="Senha"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            editable={!pending}
            onSubmitEditing={() => void login()}
          />
          {needsCode && (
            <Field
              label="Código de verificação"
              value={code}
              onChangeText={setCode}
              autoCapitalize="characters"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={16}
              editable={!pending}
              onSubmitEditing={() => void login()}
            />
          )}
          {needsCode && !error && (
            <Text style={styles.muted}>
              Esta conta usa verificação em duas etapas. Informe o código do
              aplicativo autenticador ou um código de recuperação.
            </Text>
          )}
          {error && <ErrorMessage message={error} />}
          <Button
            label={pending ? "Entrando…" : "Entrar"}
            disabled={pending || !email.trim() || !password}
            onPress={() => void login()}
          />
          <Button secondary label="Esqueci minha senha" disabled={pending} onPress={recover} />
        </Card>
        <Text style={styles.muted}>
          Use sua conta cadastrada pela administração do condomínio.
        </Text>
        {__DEV__ && (
          <Text style={styles.muted}>
            Ambiente de desenvolvimento: {api.baseUrl}
          </Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
