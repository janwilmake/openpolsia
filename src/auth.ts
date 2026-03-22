import { betterAuth } from "better-auth";
import { D1Dialect } from "kysely-d1";
import type { Env } from "./worker";

export function createAuth(env: Env) {
  return betterAuth({
    database: {
      dialect: new D1Dialect({ database: env.DB }),
      type: "sqlite"
    },
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET
      }
    },
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5
      }
    }
  });
}

export type Auth = ReturnType<typeof createAuth>;
