import type { ServiceName } from "../constants.js";

/** Map Sentry tags[service] to monitor rollup (DDIN / MVEND). */
export function mapAppServiceToRollup(appService: string): ServiceName {
  const s = appService.trim().toLowerCase();
  switch (s) {
    case "ddin_digital_services":
    case "ddin":
      return "DDIN";
    case "gwiza":
    case "mvend":
      return "MVEND";
    case "marketplace":
    case "auth":
    case "integra_phones":
    default:
      return "MVEND";
  }
}
