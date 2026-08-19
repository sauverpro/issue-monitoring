import pg from "pg";
import { config } from "../config.js";

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
});

// Without a listener, errors on idle pooled clients (e.g. a dropped connection)
// are uncaught EventEmitter errors and crash the whole process.
pool.on("error", (err) => {
  console.error("[db] idle client error", err);
});
