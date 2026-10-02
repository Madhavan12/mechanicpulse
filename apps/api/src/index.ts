import "dotenv/config";
import { buildApp } from "./app";

const PORT = Number(process.env.PORT) || 3001;
const JWT_SECRET = process.env.JWT_SECRET;
const WEB_ORIGIN = process.env.WEB_ORIGIN || "http://localhost:3000";

/** "::" binds IPv6 *and*, on a dual-stack host, IPv4 — which "0.0.0.0" does
 * not do in reverse. It matters more than it sounds: browsers may resolve
 * `localhost` to ::1, and an IPv4-only listener then simply hangs, with no
 * error the page can show. Safari does this readily. Override with HOST if
 * you're somewhere IPv6 isn't available. */
const HOST = process.env.HOST || "::";

if (!JWT_SECRET) {
  console.error("JWT_SECRET is not set. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

async function main() {
  const app = await buildApp({ jwtSecret: JWT_SECRET!, webOrigin: WEB_ORIGIN, logger: true });
  await app.listen({ port: PORT, host: HOST });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
