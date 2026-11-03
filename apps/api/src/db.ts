import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

// RDS only accepts TLS. Its certificate chain isn't in Node's trust store, so
// DATABASE_SSL=true encrypts the connection without verifying the server
// (traffic stays inside the VPC). Bundling the RDS CA and verifying is the
// tightening to do before real customer data; see docs/deploy-staging.md.
export const db = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});
