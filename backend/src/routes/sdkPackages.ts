import { Router, type IRouter } from "express";
import { existsSync, readdirSync, statSync, createReadStream } from "fs";
import { basename, join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { config } from "../config.js";

const releasesDir = join(dirname(fileURLToPath(import.meta.url)), "../../../packages/releases");
const SAFE = /^[\w.-]+\.tgz$/;

function listTarballs() {
  if (!existsSync(releasesDir)) return [];
  return readdirSync(releasesDir)
    .filter((f) => SAFE.test(f))
    .map((file) => {
      const st = statSync(join(releasesDir, file));
      const nameMatch = file.match(/^(.*)-(\d+\.\d+\.\d+.*)\.tgz$/);
      const scoped = file.startsWith("koralink-")
        ? `@koralink/${file.replace(/^koralink-/, "").replace(/-\d+\.\d+\.\d+.*\.tgz$/, "")}`
        : file;
      return {
        name: nameMatch ? `@koralink/${nameMatch[1]!.replace(/^koralink-/, "")}` : scoped,
        version: nameMatch?.[2] ?? "",
        file,
        url: `/sdk/${file}`,
        bytes: st.size,
      };
    });
}

export function sdkPackagesRouter(): IRouter {
  const r = Router();

  r.get("/sdk", (_req, res) => {
    res.json({
      packages: listTarballs(),
      installHint: `npm install --allow-remote=all ${config.publicIngestUrl}/sdk/<file.tgz>`,
      packCommand: "npm run pack:sdk",
    });
  });

  r.get("/sdk/:file", (req, res) => {
    const file = basename(req.params.file ?? "");
    if (!SAFE.test(file)) {
      res.status(400).json({ error: "Invalid file" });
      return;
    }
    const full = join(releasesDir, file);
    if (!existsSync(full)) {
      res.status(404).json({ error: "Package not packed. Run npm run pack:sdk" });
      return;
    }
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="${file}"`);
    createReadStream(full).pipe(res);
  });

  return r;
}
