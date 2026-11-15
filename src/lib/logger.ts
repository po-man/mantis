import type { FastifyServerOptions } from "fastify";

export function loggerOptions(level: string): FastifyServerOptions["logger"] {
  return {
    level,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers['set-cookie']",
      ],
      censor: "[redacted]",
    },
  };
}
