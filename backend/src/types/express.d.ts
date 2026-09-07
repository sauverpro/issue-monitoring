import type { JwtPayload } from "../middleware/jwt.js";
import type { ConsoleJwtPayload, ConsoleProject, OrgRole } from "../types/consoleAuth.js";
import type { ResolvedProjectKey } from "../services/apiKeys.js";

declare global {
  namespace Express {
    interface Request {
      auth?: JwtPayload;
      consoleAuth?: ConsoleJwtPayload;
      consoleMembership?: { orgId: string; role: OrgRole };
      consoleProject?: ConsoleProject & { organizationName: string };
      monitorProject?: ResolvedProjectKey;
    }
  }
}

export {};
