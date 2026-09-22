import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { apiFetch, setToken, getToken } from "./api";
import type { OrgListItem, OrgRole } from "@/org/types";

type AuthState = {
  email: string | null;
  token: string | null;
  isPlatformAdmin: boolean;
  mustChangePassword: boolean;
  orgs: OrgListItem[];
  org: OrgListItem | null;
  ready: boolean;
};

type AuthResponse = {
  token?: string;
  email: string;
  isPlatformAdmin: boolean;
  mustChangePassword?: boolean;
  orgs: OrgListItem[];
};

const EMAIL_KEY = "monitor_org_email";
const ADMIN_KEY = "monitor_org_platform";
const ORG_KEY = "monitor_org_id";

export type LoginResult = {
  org: OrgListItem | null;
  isPlatformAdmin: boolean;
  mustChangePassword: boolean;
};

const AuthContext = createContext<{
  auth: AuthState;
  login: (email: string, password: string) => Promise<LoginResult>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
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

const EMPTY: AuthState = {
  email: null,
  token: null,
  isPlatformAdmin: false,
  mustChangePassword: false,
  orgs: [],
  org: null,
  ready: true,
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(() => ({
    ...EMPTY,
    email: localStorage.getItem(EMAIL_KEY),
    token: getToken(),
    isPlatformAdmin: localStorage.getItem(ADMIN_KEY) === "1",
    ready: !getToken(),
  }));

  const apply = useCallback((res: AuthResponse): LoginResult => {
    if (res.token) setToken(res.token);
    const org = pickOrg(res.orgs);
    if (org) localStorage.setItem(ORG_KEY, org.id);
    else localStorage.removeItem(ORG_KEY);
    localStorage.setItem(EMAIL_KEY, res.email);
    localStorage.setItem(ADMIN_KEY, res.isPlatformAdmin ? "1" : "0");
    const mustChangePassword = res.mustChangePassword ?? false;
    setAuth({
      email: res.email,
      token: res.token ?? getToken(),
      isPlatformAdmin: res.isPlatformAdmin,
      mustChangePassword,
      orgs: res.orgs,
      org,
      ready: true,
    });
    return { org, isPlatformAdmin: res.isPlatformAdmin, mustChangePassword };
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
        setAuth(EMPTY);
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

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      await apiFetch("/console/auth/change-password", {
        method: "POST",
        json: { currentPassword, newPassword },
      });
      setAuth((prev) => ({ ...prev, mustChangePassword: false }));
    },
    []
  );

  const logout = useCallback(() => {
    setToken(null);
    localStorage.removeItem(EMAIL_KEY);
    localStorage.removeItem(ADMIN_KEY);
    localStorage.removeItem(ORG_KEY);
    setAuth(EMPTY);
  }, []);

  const value = useMemo(
    () => ({ auth, login, changePassword, logout }),
    [auth, login, changePassword, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}

const RANK: Record<OrgRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

/** Effective role in an org. Platform admins act as owner everywhere. */
export function orgRoleFor(
  auth: { isPlatformAdmin: boolean; orgs: OrgListItem[]; org: OrgListItem | null },
  orgId?: string
): OrgRole | null {
  if (auth.isPlatformAdmin) return "owner";
  const match = orgId ? auth.orgs.find((o) => o.id === orgId) : null;
  return (match ?? (orgId ? null : auth.org))?.role ?? null;
}

export function roleAtLeast(role: OrgRole | null, min: OrgRole): boolean {
  return role != null && RANK[role] >= RANK[min];
}

/** Admin+ may manage projects, members, API keys and integration settings. */
export function useCanManage(orgId?: string): boolean {
  const { auth } = useAuth();
  return roleAtLeast(orgRoleFor(auth, orgId), "admin");
}

export function orgHomePath(org: OrgListItem | null): string {
  return org ? `/orgs/${org.id}` : "/";
}

/** Post-login landing based on role. Platform admins go to /platform; org members to their org. */
export function postLoginPath(auth: {
  isPlatformAdmin: boolean;
  org: OrgListItem | null;
  mustChangePassword?: boolean;
}): string {
  if (auth.mustChangePassword) return "/change-password";
  if (auth.isPlatformAdmin) return "/platform";
  return orgHomePath(auth.org);
}
