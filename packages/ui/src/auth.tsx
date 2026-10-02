import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, setAuthLostHandler, tokens, type Session } from "./api.js";
import { createAuthActions } from "./auth-state.js";

type AuthUser = Session["user"];

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** First building the user administers or lives in. Panels are single-building by nature. */
  buildingId: string | null;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const actions = useMemo(() => createAuthActions({ api, tokens, onUserChange: setUser, onLoadingChange: setLoading }), []);

  useEffect(() => {
    setAuthLostHandler(actions.authLost);
    void actions.restore();
    return () => {
      actions.cancel();
      setAuthLostHandler(null);
    };
  }, [actions]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      signIn: actions.signIn,
      signOut: actions.signOut,
      buildingId: user?.memberships[0]?.buildingId ?? null,
    }),
    [user, loading, actions],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth precisa estar dentro de <AuthProvider>");
  return context;
}
