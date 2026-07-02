import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { apiFetch, setToken, TOKEN_KEY } from "./api";

type AuthState = {
  email: string | null;
  token: string | null;
  ready: boolean;
};

const AuthContext = createContext<{
  auth: AuthState;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
} | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(() => ({
    email: localStorage.getItem("koralink_email"),
    token: localStorage.getItem(TOKEN_KEY),
    ready: true,
  }));

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiFetch<{ token: string; email: string }>(
      "/auth/login",
      {
        method: "POST",
        json: { email, password },
      }
    );
    setToken(res.token);
    localStorage.setItem("koralink_email", res.email);
    setAuth({ email: res.email, token: res.token, ready: true });
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    localStorage.removeItem("koralink_email");
    setAuth({ email: null, token: null, ready: true });
  }, []);

  const value = useMemo(
    () => ({ auth, login, logout }),
    [auth, login, logout]
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}
