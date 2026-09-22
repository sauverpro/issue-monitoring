import { randomBytes } from "crypto";
import type { OrgRole } from "../types/consoleAuth.js";

const RANK: Record<OrgRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

/**
 * One-time password handed to the admin who provisioned the account. The user is
 * forced to replace it on first login (console_users.must_change_password).
 */
export function generateTempPassword(): string {
  return `Mntr-${randomBytes(9).toString("base64url")}`;
}

export function roleAtLeast(role: OrgRole, min: OrgRole): boolean {
  return RANK[role] >= RANK[min];
}

/** Viewers can read dashboards; keys and writes need member+. */
export function canViewKeys(role: OrgRole): boolean {
  return roleAtLeast(role, "admin");
}

export function canManageProject(role: OrgRole): boolean {
  return roleAtLeast(role, "admin");
}

export function canInviteMembers(role: OrgRole): boolean {
  return roleAtLeast(role, "admin");
}

export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || "project";
}
