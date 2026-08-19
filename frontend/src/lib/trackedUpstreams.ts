/**
 * The five APIs the Koralink app calls. Sentry events are classified onto
 * these services from the request URL host (see backend sentryServiceMap).
 */
export const TRACKED_UPSTREAM_APIS = [
  {
    label: "MVEND / Gwiza Payments",
    envHint: "openapi.gwiza.tech",
    baseUrl: "https://openapi.gwiza.tech/",
    typicalService: "MVEND" as const,
  },
  {
    label: "Koralink Core API",
    envHint: "www.djyh.rw/api/v1",
    baseUrl: "https://www.djyh.rw/api/v1/",
    typicalService: "KORALINK" as const,
  },
  {
    label: "DDIN Digital Services",
    envHint: "core-api.ddin.rw/v1",
    baseUrl: "https://core-api.ddin.rw/v1/",
    typicalService: "DDIN" as const,
  },
  {
    label: "Integra / Intelligra",
    envHint: "rw-prod.intelligra.io",
    baseUrl: "https://rw-prod.intelligra.io/intelligrapi/",
    typicalService: "INTEGRA" as const,
  },
  {
    label: "ResolveIt Ticketing",
    envHint: "resolveit.rw",
    baseUrl: "https://resolveit.rw/",
    typicalService: "RESOLVEIT" as const,
  },
] as const;
