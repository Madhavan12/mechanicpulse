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
  webOrigin: string;
  logger?: boolean;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  await app.register(cors, { origin: opts.webOrigin });
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
