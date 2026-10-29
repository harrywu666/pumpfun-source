import type { FastifyInstance } from "fastify";

/**
 * Node normalizes singleton header fields before Fastify sees them. Reject
 * repeated Content-Type fields before parsing so the selected media type does
 * not depend on header order or on which proxy inspected the request.
 */
export function rejectDuplicateContentTypeFields(app: FastifyInstance): void {
  app.addHook("preParsing", async (request, reply, payload) => {
    let fields = 0;
    for (let index = 0; index < request.raw.rawHeaders.length; index += 2) {
      if (request.raw.rawHeaders[index].toLowerCase() === "content-type")
        fields += 1;
    }
    if (fields > 1)
      reply.code(400).send({
        statusCode: 400,
        error: "DUPLICATE_CONTENT_TYPE",
      });
    return payload;
  });
}
