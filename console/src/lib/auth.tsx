import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { apiFetch, setToken, getToken } from "./api";

type AuthState = {
  email: string | null;
  token: string | null;
  isPlatformAdmin: boolean;
  ready: boolean;
};

const EMAIL_KEY = "monitor_console_email";
const ADMIN_KEY = "monitor_console_platform";

const AuthContext = createContext<{
  auth: AuthState;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => void;
} | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(() => ({
    email: localStorage.getItem(EMAIL_KEY),
    token: getToken(),
    isPlatformAdmin: localStorage.getItem(ADMIN_KEY) === "1",
    ready: true,
  }));

  const apply = useCallback(
    (res: { token: string; email: string; isPlatformAdmin: boolean }) => {
      setToken(res.token);
      localStorage.setItem(EMAIL_KEY, res.email);
      localStorage.setItem(ADMIN_KEY, res.isPlatformAdmin ? "1" : "0");
      setAuth({
        email: res.email,
        token: res.token,
        isPlatformAdmin: res.isPlatformAdmin,
        ready: true,
      });
    },
    []
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await apiFetch<{ token: string; email: string; isPlatformAdmin: boolean }>(
        "/console/auth/login",
        { method: "POST", json: { email, password } }
      );
      apply(res);
    },
    [apply]
  );

  const register = useCallback(
    async (email: string, password: string, name?: string) => {
      const res = await apiFetch<{ token: string; email: string; isPlatformAdmin: boolean }>(
        "/console/auth/register",
        { method: "POST", json: { email, password, name } }
      );
      apply(res);
    },
    [apply]
  );

  const logout = useCallback(() => {
    setToken(null);
    localStorage.removeItem(EMAIL_KEY);
    localStorage.removeItem(ADMIN_KEY);
    setAuth({ email: null, token: null, isPlatformAdmin: false, ready: true });
  }, []);

  const value = useMemo(
    () => ({ auth, login, register, logout }),
    [auth, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}
