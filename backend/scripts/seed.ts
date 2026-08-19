import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "../.env") });
import bcrypt from "bcryptjs";
import pg from "pg";
import { randomUUID } from "crypto";

async function main() {
  const url = process.env.DATABASE_URL;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!url || !email || !password) {
    console.error("DATABASE_URL, ADMIN_EMAIL, and ADMIN_PASSWORD are required");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const hash = await bcrypt.hash(password, 12);
    await client.query(
      `INSERT INTO dashboard_users (id, email, password_hash, role)
       VALUES ($1, $2, $3, 'admin')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin'`,
      [randomUUID(), email, hash]
    );
    console.log("Admin user upserted:", email);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
