import "dotenv/config";
import { buildApp } from "./app";

const PORT = Number(process.env.PORT) || 3001;
const JWT_SECRET = process.env.JWT_SECRET;
const WEB_ORIGIN = process.env.WEB_ORIGIN || "http://localhost:3000";

if (!JWT_SECRET) {
  console.error("JWT_SECRET is not set. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

async function main() {
  const app = await buildApp({ jwtSecret: JWT_SECRET!, webOrigin: WEB_ORIGIN, logger: true });
  await app.listen({ port: PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
