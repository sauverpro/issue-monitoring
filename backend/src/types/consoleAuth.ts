export const ORG_ROLES = ["viewer", "member", "admin", "owner"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export type ConsoleJwtPayload = {
  sub: string;
  email: string;
  aud: "console";
  isPlatformAdmin: boolean;
};

export type ConsoleProject = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  platform: "react-native" | "web";
  allowedHosts: string[];
  retentionDays: number;
};

export type ProjectUpstream = {
  id: string;
  slug: string;
  host: string;
  label: string;
};
