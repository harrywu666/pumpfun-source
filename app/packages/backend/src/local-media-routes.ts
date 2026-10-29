import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  IMAGE_TYPES,
  LOCAL_MEDIA_PREFIX,
  LocalMediaError,
  LocalMediaStore,
  MAX_IMAGE_BYTES,
} from "./local-media-store.js";

export type LocalMediaOptions = { store: LocalMediaStore; token: string };

/** Explicit, local-only opt-in. Does not register Pump/IPFS/Pinata endpoints. */
export function registerLocalMediaRoutes(
  app: FastifyInstance,
  options: LocalMediaOptions,
) {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(options.token))
    throw new Error(
      "Local media requires a separate 32–256 character local capability token.",
    );
  const expected = createHash("sha256").update(options.token).digest();
  // Encapsulation prevents image parsers and local authorization from affecting other APIs.
  app.register(
    async (local) => {
      local.addHook("onRequest", async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        reply.header("X-Content-Type-Options", "nosniff");
        reply.header("Content-Security-Policy", "default-src 'none'; sandbox");
        reply.header("X-Reconstruction-Mode", "local-only");
        const remote = request.raw.socket.remoteAddress;
        if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote ?? "")) {
          return reply
            .code(403)
            .send({ code: "LOCAL_MEDIA_LOOPBACK_REQUIRED" });
        }
        // This development API intentionally does not accept browser cookie auth or origins.
        if (
          request.headers.origin !== undefined ||
          request.headers["sec-fetch-site"] === "cross-site"
        ) {
          return reply.code(403).send({ code: "LOCAL_MEDIA_ORIGIN_FORBIDDEN" });
        }
        // Node may discard later Authorization fields while normalizing headers.
        // This capability has exactly one source; never select one duplicate,
        // even when the repeated values are identical.
        let authorizationFields = 0;
        for (let index = 0; index < request.raw.rawHeaders.length; index += 2) {
          if (request.raw.rawHeaders[index].toLowerCase() === "authorization")
            authorizationFields += 1;
        }
        const auth = request.headers.authorization;
        // HTTP authentication scheme names are case-insensitive (RFC 9110 11.1).
        const token =
          typeof auth === "string" && /^Bearer /i.test(auth)
            ? auth.slice(7)
            : "";
        if (
          authorizationFields !== 1 ||
          typeof auth !== "string" ||
          token.length > 256 ||
          !timingSafeEqual(
            createHash("sha256").update(token).digest(),
            expected,
          )
        ) {
          return reply.code(401).send({ code: "LOCAL_MEDIA_AUTH_REQUIRED" });
        }
      });
      local.setErrorHandler((error, _request, reply) => {
        if (error instanceof LocalMediaError)
          return reply
            .code(error.status)
            .send({ code: error.code, message: error.message });
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 413)
          return reply.code(413).send({ code: "LOCAL_MEDIA_BODY_TOO_LARGE" });
        if (status === 415)
          return reply.code(415).send({ code: "LOCAL_MEDIA_CONTENT_TYPE" });
        if (status === 400)
          return reply.code(400).send({ code: "LOCAL_MEDIA_INVALID" });
        return reply.code(500).send({ code: "LOCAL_MEDIA_STORAGE_FAILURE" });
      });
      for (const type of IMAGE_TYPES)
        local.addContentTypeParser(
          type,
          { parseAs: "buffer", bodyLimit: MAX_IMAGE_BYTES },
          (_request, body, done) => done(null, body),
        );
      local.post(
        "/images",
        { bodyLimit: MAX_IMAGE_BYTES },
        async (request, reply) => {
          if (!Buffer.isBuffer(request.body))
            throw new LocalMediaError(
              "LOCAL_MEDIA_IMAGE_TYPE",
              415,
              "Send raw image bytes with an image MIME type.",
            );
          const mime =
            request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() ?? "";
          const result = await options.store.putImage(request.body, mime);
          return reply.code(result.created ? 201 : 200).send(result);
        },
      );
      local.get<{ Params: { id: string } }>(
        "/images/:id",
        async (request) => options.store.getImage(request.params.id).descriptor,
      );
      local.get<{ Params: { id: string } }>(
        "/images/:id/content",
        async (request, reply) => {
          const image = options.store.getImage(request.params.id);
          return reply
            .header("Content-Disposition", "attachment")
            .type(image.descriptor.mime)
            .send(image.content);
        },
      );
      local.post("/metadata", { bodyLimit: 16_384 }, async (request, reply) => {
        const result = await options.store.putMetadata(request.body);
        return reply.code(result.created ? 201 : 200).send(result);
      });
      local.get<{ Params: { id: string } }>("/metadata/:id", async (request) =>
        options.store.getMetadata(request.params.id),
      );
      local.get<{ Params: { id: string } }>(
        "/metadata/:id/content",
        async (request) =>
          options.store.getMetadata(request.params.id).metadata,
      );
      local.delete<{ Params: { id: string } }>(
        "/metadata/:id",
        async (request, reply) => {
          await options.store.deleteMetadata(request.params.id);
          return reply.code(204).send();
        },
      );
      local.delete<{ Params: { id: string } }>(
        "/images/:id",
        async (request, reply) => {
          await options.store.deleteImage(request.params.id);
          return reply.code(204).send();
        },
      );
    },
    { prefix: LOCAL_MEDIA_PREFIX },
  );
}
