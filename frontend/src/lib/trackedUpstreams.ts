/**
 * Reference: upstream bases Koralink clients may call and forward to POST /events.
 * `service` on each event is still DDIN or MVEND — map vendor calls in the app when ingesting.
 */
export const TRACKED_UPSTREAM_APIS = [
  {
    label: "Koralink main API",
    envHint: "primary backend",
    baseUrl: "https://www.koralink.org",
  },
  {
    label: "Gwiza / MVEND digital services",
    envHint: "OpenAPI (payments & digital services)",
    baseUrl: "https://openapi.gwiza.tech",
    typicalService: "MVEND" as const,
  },
  {
    label: "DDIN digital services",
    envHint: "DIGITAL_SERVICES_BASE_URL",
    baseUrl: "https://core-api.ddin.rw/v1/agency",
    typicalService: "DDIN" as const,
  },
  {
    label: "Tickets (Resolve It)",
    envHint: "TICKETS_BASE_URL",
    baseUrl: "https://resolveit.rw",
  },
] as const;
