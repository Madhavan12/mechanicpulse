import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { authRoutes } from "./routes/auth";
import { mediaRoutes } from "./routes/media";
import { jobsRoutes } from "./routes/jobs";
import { findingsRoutes } from "./routes/findings";
import { reportsRoutes } from "./routes/reports";
import { customerReportRoutes } from "./routes/customerReport";
import { smsWebhookRoutes } from "./routes/smsWebhook";
import { createConsoleProvider } from "./lib/sms/consoleProvider";
import type { SmsProvider } from "./lib/sms/provider";

export const SMS_STATUS_PATH = "/api/sms/twilio/status";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Where the customer-facing app is served from — used to build the
     * report link that goes in the SMS. */
    webOrigin: string;
    /** Whatever delivers texts: Twilio in prod, a logger in dev and CI. */
    sms: SmsProvider;
    /** Where the provider reports delivery to; undefined when the API has no
     * public address, in which case messages never move past `sent`. */
    smsStatusCallbackUrl: string | undefined;
  }
}

export interface BuildAppOptions {
  jwtSecret: string;
  webOrigin: string;
  logger?: boolean;
  /** Defaults to the console provider, so tests never send anything. */
  sms?: SmsProvider;
  /** The API's own public base URL, for delivery callbacks. */
  publicApiUrl?: string;
  /** Verifies provider callbacks. Without it the webhook refuses everything. */
  twilioAuthToken?: string;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  await app.register(cors, { origin: opts.webOrigin });
  await app.register(jwt, { secret: opts.jwtSecret });

  app.decorate("webOrigin", opts.webOrigin);
  app.decorate("sms", opts.sms ?? createConsoleProvider(() => {}));
  const publicApiUrl = opts.publicApiUrl?.replace(/\/+$/, "");
  app.decorate("smsStatusCallbackUrl", publicApiUrl ? `${publicApiUrl}${SMS_STATUS_PATH}` : undefined);

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
  await app.register(findingsRoutes);
  await app.register(reportsRoutes);
  await app.register(customerReportRoutes);
  await app.register(smsWebhookRoutes, { authToken: opts.twilioAuthToken, callbackUrl: app.smsStatusCallbackUrl });

  return app;
}
