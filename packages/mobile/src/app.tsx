import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  ApiError,
  createApiClient,
  type ApiClient,
} from "@predioon/api-client";
import type { AuthUser } from "@predioon/contracts/auth";
import type { AuthorizationResponse } from "@predioon/contracts/tenancy";
import { nativeTokenStorage } from "./keychain.ts";
import { createBoundedFetch } from "./bounded-fetch.ts";
import { createSessionActionScope } from "./session-actions.ts";
import {
  type Feature,
  type Product,
  type Screen,
  screensFor,
  validateApiUrl,
} from "./scope.ts";
import type { Building, List } from "./models.ts";
import { useResource } from "./resource.ts";
import { Alerts, Overview, Readings } from "./operations.tsx";
import { Notices, Reservations, Tickets, Transparency } from "./resident.tsx";
import { Access } from "./access.tsx";
import {
  createAccessIntentStore,
  type AccessIntentStore,
} from "./access-intents.ts";
import { createNativeRequestId } from "./secure-request-id.ts";
import {
  Button,
  Card,
  colors,
  ErrorMessage,
  Feedback,
  Field,
  Refresh,
  styles,
} from "./ui.tsx";

const titles: Record<Screen, string> = {
  notices: "Avisos",
  tickets: "Solicitações",
  reservations: "Reservas",
  transparency: "Transparência",
  access: "Acessos",
  overview: "Resumo",
  alerts: "Alertas",
  readings: "Sensores",
};
const productTitles: Record<Product, string> = {
  resident: "Prédio ON Morador",
  operations: "Prédio ON Operação",
};

const boundedFetch = createBoundedFetch((input, init) => fetch(input, init));

export function PredioApp({
  product,
  apiUrl,
}: {
  product: Product;
  apiUrl: string;
}) {
  let normalized = "";
  try {
    normalized = validateApiUrl(apiUrl, __DEV__);
  } catch {
    /* An unconfigured release must not submit credentials anywhere. */
  }
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={styles.root}>
        {normalized ? (
          <ConnectedApp
            key={`${product}:${normalized}`}
            product={product}
            baseUrl={normalized}
          />
        ) : (
          <View style={styles.page}>
            <Text style={styles.title}>{productTitles[product]}</Text>
            <ErrorMessage message="A API deste aplicativo ainda não foi configurada. Informe um endereço HTTPS em config.ts antes de gerar a versão de distribuição." />
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function ConnectedApp({
  product,
  baseUrl,
}: {
  product: Product;
  baseUrl: string;
}) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<Building | null>(null);
  const accessIntents = useMemo(
    () => createAccessIntentStore(createNativeRequestId),
    [user?.id],
  );
  const accessRef = useRef(accessIntents);
  accessRef.current = accessIntents;
  const actions = useMemo(createSessionActionScope, []);
  const storage = useMemo(
    () => nativeTokenStorage(product, baseUrl),
    [product, baseUrl],
  );
  const api = useMemo(
    () =>
      createApiClient({
        baseUrl,
        storage,
        fetch: boundedFetch,
        onAuthLost: () => {
          accessRef.current.invalidate();
          setUser(null);
          setSelected(null);
        },
      }),
    [baseUrl, storage],
  );
  useEffect(() => {
    let live = true;
    setBooting(true);
    setBootError(null);
    void (async () => {
      if (!(await storage.getTokens())) return;
      const profile = await api.get<AuthUser>("/auth/me");
      if (live) setUser(profile);
    })()
      .catch((error) => {
        if (
          live &&
          !(error instanceof ApiError && [401, 403].includes(error.status))
        )
          setBootError(
            error instanceof Error
              ? error.message
              : "Não foi possível restaurar a sessão.",
          );
      })
      .finally(() => {
        if (live) setBooting(false);
      });
    return () => {
      live = false;
      api.invalidateSession();
    };
  }, [api, storage, retry]);
  async function signOut() {
    const action = actions.begin();
    accessRef.current.invalidate();
    setUser(null);
    setSelected(null);
    setBootError(null);
    try {
      await api.logout();
    } catch (error) {
      if (
        !actions.isCurrent(action) ||
        (error instanceof ApiError && error.code === "SESSION_CHANGED")
      )
        return;
      setBootError(
        error instanceof Error
          ? error.message
          : "Falha ao apagar a sessão deste dispositivo.",
      );
    }
  }
  if (booting)
    return (
      <View style={styles.page}>
        <ActivityIndicator
          accessibilityLabel="Restaurando sessão"
          color={colors.green}
        />
      </View>
    );
  if (bootError)
    return (
      <View style={styles.page}>
        <Text style={styles.title}>{productTitles[product]}</Text>
        <ErrorMessage
          message={bootError}
          retry={() => setRetry((value) => value + 1)}
        />
        <Button
          secondary
          label="Encerrar sessão neste aparelho"
          onPress={() => void signOut()}
        />
      </View>
    );
  if (!user)
    return (
      <Login
        key={product}
        api={api}
        product={product}
        beginSignIn={() => {
          actions.begin();
          accessRef.current.invalidate();
          setBootError(null);
        }}
        signedIn={(profile) => {
          setSelected(null);
          setUser(profile);
        }}
      />
    );
  return (
    <>
      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: 8,
          gap: 10,
        }}
      >
        <Text style={styles.subtitle}>{productTitles[product]}</Text>
        <View style={styles.row}>
          <Text numberOfLines={1} style={[styles.muted, { flex: 1 }]}>
            {user.name}
          </Text>
          <Button label="Sair" secondary onPress={() => void signOut()} />
        </View>
        <Text numberOfLines={1} style={styles.muted}>
          {user.email}
        </Text>
      </View>
      {selected ? (
        <BuildingApp
          key={`${user.id}:${selected.id}`}
          {...{ api, product, user, accessIntents }}
          building={selected}
          chooseBuilding={() => setSelected(null)}
        />
      ) : (
        <BuildingPicker {...{ api }} choose={setSelected} />
      )}
    </>
  );
}

function Login({
  api,
  product,
  beginSignIn,
  signedIn,
}: {
  api: ApiClient;
  product: Product;
  beginSignIn(): void;
  signedIn(user: AuthUser): void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function login() {
    if (pending) return;
    beginSignIn();
    setPending(true);
    setError(null);
    try {
      const session = await api.login(email.trim(), password);
      setPassword("");
      signedIn(session.user);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível entrar.",
      );
    } finally {
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
          {error && <ErrorMessage message={error} />}
          <Button
            label={pending ? "Entrando…" : "Entrar"}
            disabled={pending || !email.trim() || !password}
            onPress={() => void login()}
          />
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

function BuildingPicker({
  api,
  choose,
}: {
  api: ApiClient;
  choose(building: Building): void;
}) {
  const resource = useResource<List<Building>>(api, "/buildings");
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>Escolha o condomínio</Text>
      <Refresh resource={resource} />
      <Feedback
        resource={resource}
        empty={resource.data?.items.length === 0}
        emptyMessage="Sua conta não possui condomínios disponíveis. Solicite acesso à administração."
      />
      {resource.data?.items.map((building) => (
        <Card key={building.id}>
          <Text style={styles.subtitle}>{building.name}</Text>
          <Text style={styles.muted}>{building.code}</Text>
          <Button label="Acessar condomínio" onPress={() => choose(building)} />
        </Card>
      ))}
    </ScrollView>
  );
}

function BuildingApp({
  api,
  product,
  user,
  building,
  chooseBuilding,
  accessIntents,
}: {
  api: ApiClient;
  product: Product;
  user: AuthUser;
  building: Building;
  chooseBuilding(): void;
  accessIntents: AccessIntentStore;
}) {
  const authorization = useResource<AuthorizationResponse>(
    api,
    `/v1/authorization?buildingId=${encodeURIComponent(building.id)}`,
  );
  const features = useResource<List<Feature>>(
    api,
    `/features/buildings/${encodeURIComponent(building.id)}`,
  );
  const [selected, setSelected] = useState<Screen | null>(null);
  const scope = {
    buildingId: building.id,
    capabilities: authorization.data?.capabilities ?? [],
    features: features.data?.items ?? [],
  };
  const screens = screensFor(product, scope);
  const ready = Boolean(authorization.data && features.data);
  const current =
    selected && screens.includes(selected) ? selected : screens[0];
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={{ paddingHorizontal: 20, gap: 10 }}>
        <View style={styles.row}>
          <Text numberOfLines={2} style={[styles.subtitle, { flex: 1 }]}>
            {building.name}
          </Text>
          <Button label="Trocar" secondary onPress={chooseBuilding} />
        </View>
        {ready && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingVertical: 8 }}
          >
            {screens.map((screen) => (
              <Button
                key={screen}
                label={titles[screen]}
                secondary={screen !== current}
                onPress={() => setSelected(screen)}
              />
            ))}
          </ScrollView>
        )}
      </View>
      <ScrollView
        key={current ?? "permissions"}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.page}
      >
        <Feedback resource={authorization} />
        <Feedback resource={features} />
        {ready && !current && (
          <Card>
            <Text style={styles.subtitle}>Sem módulos disponíveis</Text>
            <Text style={styles.text}>
              Este perfil não possui acesso aos módulos deste aplicativo neste
              condomínio. A administração pode verificar suas permissões.
            </Text>
          </Card>
        )}
        {ready && current && (
          <>
            <Text style={styles.title}>{titles[current]}</Text>
            {current === "notices" && (
              <Notices api={api} buildingId={building.id} />
            )}
            {current === "tickets" && (
              <Tickets
                api={api}
                buildingId={building.id}
                product={product}
                userId={user.id}
                scope={scope}
              />
            )}
            {current === "reservations" && (
              <Reservations api={api} buildingId={building.id} scope={scope} />
            )}
            {current === "transparency" && (
              <Transparency api={api} buildingId={building.id} scope={scope} />
            )}
            {current === "access" && (
              <Access api={api} scope={scope} intents={accessIntents} />
            )}
            {current === "overview" && (
              <Overview api={api} buildingId={building.id} />
            )}
            {current === "alerts" && (
              <Alerts api={api} buildingId={building.id} scope={scope} />
            )}
            {current === "readings" && (
              <Readings api={api} buildingId={building.id} />
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
