import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { apiFetch, setToken, getToken } from "./api";
import type { OrgListItem } from "@/org/types";

type AuthState = {
  email: string | null;
  token: string | null;
  isPlatformAdmin: boolean;
  orgs: OrgListItem[];
  org: OrgListItem | null;
  ready: boolean;
};

type AuthResponse = {
  token?: string;
  email: string;
  isPlatformAdmin: boolean;
  orgs: OrgListItem[];
};

const EMAIL_KEY = "monitor_org_email";
const ADMIN_KEY = "monitor_org_platform";
const ORG_KEY = "monitor_org_id";

export type LoginResult = {
  org: OrgListItem | null;
  isPlatformAdmin: boolean;
};

const AuthContext = createContext<{
  auth: AuthState;
  login: (email: string, password: string) => Promise<LoginResult>;
  register: (email: string, password: string, name?: string) => Promise<LoginResult>;
  logout: () => void;
} | null>(null);

function pickOrg(orgs: OrgListItem[]): OrgListItem | null {
  const preferred = localStorage.getItem(ORG_KEY);
  if (preferred) {
    const match = orgs.find((o) => o.id === preferred);
    if (match) return match;
  }
  return orgs[0] ?? null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(() => ({
    email: localStorage.getItem(EMAIL_KEY),
    token: getToken(),
    isPlatformAdmin: localStorage.getItem(ADMIN_KEY) === "1",
    orgs: [],
    org: null,
    ready: !getToken(),
  }));

  const apply = useCallback((res: AuthResponse): LoginResult => {
    if (res.token) setToken(res.token);
    const org = pickOrg(res.orgs);
    if (org) localStorage.setItem(ORG_KEY, org.id);
    else localStorage.removeItem(ORG_KEY);
    localStorage.setItem(EMAIL_KEY, res.email);
    localStorage.setItem(ADMIN_KEY, res.isPlatformAdmin ? "1" : "0");
    setAuth({
      email: res.email,
      token: res.token ?? getToken(),
      isPlatformAdmin: res.isPlatformAdmin,
      orgs: res.orgs,
      org,
      ready: true,
    });
    return { org, isPlatformAdmin: res.isPlatformAdmin };
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    void apiFetch<AuthResponse>("/console/auth/me")
      .then((res) => apply({ ...res, token }))
      .catch(() => {
        setToken(null);
        localStorage.removeItem(EMAIL_KEY);
        localStorage.removeItem(ADMIN_KEY);
        localStorage.removeItem(ORG_KEY);
        setAuth({
          email: null,
          token: null,
          isPlatformAdmin: false,
          orgs: [],
          org: null,
          ready: true,
        });
      });
  }, [apply]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await apiFetch<AuthResponse>("/console/auth/login", {
        method: "POST",
        json: { email, password },
      });
      return apply(res);
    },
    [apply]
  );

  const register = useCallback(
    async (email: string, password: string, name?: string) => {
      const res = await apiFetch<AuthResponse>("/console/auth/register", {
        method: "POST",
        json: { email, password, name },
      });
      return apply(res);
    },
    [apply]
  );

  const logout = useCallback(() => {
    setToken(null);
    localStorage.removeItem(EMAIL_KEY);
    localStorage.removeItem(ADMIN_KEY);
    localStorage.removeItem(ORG_KEY);
    setAuth({
      email: null,
      token: null,
      isPlatformAdmin: false,
      orgs: [],
      org: null,
      ready: true,
    });
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

export function orgHomePath(org: OrgListItem | null): string {
  return org ? `/orgs/${org.id}` : "/";
}

/** Post-login landing based on role. Platform admins go to /platform; org members to their org. */
export function postLoginPath(auth: {
  isPlatformAdmin: boolean;
  org: OrgListItem | null;
}): string {
  if (auth.isPlatformAdmin) return "/platform";
  return orgHomePath(auth.org);
}
