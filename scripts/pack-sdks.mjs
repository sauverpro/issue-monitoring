import { mkdirSync, readdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "packages", "releases");
mkdirSync(outDir, { recursive: true });

const packages = ["monitor-core", "monitor-web", "monitor-react-native"];

for (const name of packages) {
  const dir = join(root, "packages", name);
  console.log("Building", name);
  execSync("npm run build", { cwd: dir, stdio: "inherit" });
  console.log("Packing", name);
  execSync(`npm pack --pack-destination "${outDir}"`, { cwd: dir, stdio: "inherit" });
}

const files = existsSync(outDir)
  ? readdirSync(outDir).filter((f) => f.endsWith(".tgz"))
  : [];
console.log("Released tarballs in packages/releases:");
for (const f of files) console.log(" ", f);
