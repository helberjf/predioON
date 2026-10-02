import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  api,
  setAuthLostHandler,
  setSessionAvailableHandler,
  type Session,
} from "./api.js";
import { createAuthActions } from "./auth-state.js";
import {
  createAccessIntentStore,
  type AccessIntentStore,
} from "./access-intents.js";

type AuthUser = Session["user"];

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  retryRestore: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  signOutAfter: (operation: () => Promise<void>) => Promise<void>;
  accessIntents: AccessIntentStore;
  /** First building the user administers or lives in. Panels are single-building by nature. */
  buildingId: string | null;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessIntents, setAccessIntents] = useState(() =>
    createAccessIntentStore(() => crypto.randomUUID()),
  );
  const intentsRef = useRef(accessIntents);
  const actions = useMemo(
    () =>
      createAuthActions({
        api,
        onUserChange: setUser,
        onLoadingChange: setLoading,
        onErrorChange: setError,
        onSessionReset: () => {
          // Invalidate synchronously: an awaited preflight may resume before React
          // commits the next identity. A normal token refresh does not reset this.
          intentsRef.current.invalidate();
          const next = createAccessIntentStore(() => crypto.randomUUID());
          intentsRef.current = next;
          setAccessIntents(next);
        },
      }),
    [],
  );

  useEffect(() => {
    setAuthLostHandler(actions.authLost);
    setSessionAvailableHandler(() => {
      void actions.restore();
    });
    void actions.restore();
    return () => {
      actions.cancel();
      setAuthLostHandler(null);
      setSessionAvailableHandler(null);
    };
  }, [actions]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      error,
      retryRestore: actions.restore,
      signIn: actions.signIn,
      signOut: actions.signOut,
      signOutAfter: actions.signOutAfter,
      accessIntents,
      buildingId: user?.memberships[0]?.buildingId ?? null,
    }),
    [user, loading, error, actions, accessIntents],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context)
    throw new Error("useAuth precisa estar dentro de <AuthProvider>");
  return context;
}
