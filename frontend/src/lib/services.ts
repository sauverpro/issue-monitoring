export const SERVICES = ["DDIN", "MVEND", "KORALINK", "INTEGRA", "RESOLVEIT"] as const;
export type ServiceName = (typeof SERVICES)[number];

export const SERVICE_LABELS: Record<ServiceName, string> = {
  DDIN: "DDIN Digital Services API",
  MVEND: "MVEND / Gwiza Payments API",
  KORALINK: "Koralink Core API",
  INTEGRA: "Integra / Intelligra API",
  RESOLVEIT: "ResolveIt Ticketing API",
};

export const SERVICE_BLURBS: Record<ServiceName, string> = {
  DDIN: "Digital services",
  MVEND: "Gwiza digital payments",
  KORALINK: "Marketplace core",
  INTEGRA: "Intelligra",
  RESOLVEIT: "Ticket management",
};
