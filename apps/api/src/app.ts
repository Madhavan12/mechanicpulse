import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { authRoutes } from "./routes/auth";
import { mediaRoutes } from "./routes/media";
import { jobsRoutes } from "./routes/jobs";
import { reportsRoutes } from "./routes/reports";
import { customerReportRoutes } from "./routes/customerReport";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Where the customer-facing app is served from — used to build the
     * report link that goes in the SMS. */
    webOrigin: string;
  }
}

export interface BuildAppOptions {
  jwtSecret: string;
  /** One or more allowed browser origins, comma-separated. A list because
   * loopback has two spellings (localhost and 127.0.0.1, which differ to CORS
   * and to IPv6-preferring browsers), and because staging and production will
   * eventually both need to be allowed. Never a wildcard — see
   * docs/spike-results.md for what a wildcard CORS rule cost us once already. */
  webOrigin: string;
  logger?: boolean;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  const allowedOrigins = opts.webOrigin
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  await app.register(cors, { origin: allowedOrigins });
  await app.register(jwt, { secret: opts.jwtSecret });

  app.decorate("webOrigin", opts.webOrigin);

  app.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      reply.status(401).send({ error: "unauthenticated", message: "Log in again." });
    }
  });

  app.get("/health", async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(mediaRoutes);
  await app.register(jobsRoutes);
  await app.register(reportsRoutes);
  await app.register(customerReportRoutes);

  return app;
}
