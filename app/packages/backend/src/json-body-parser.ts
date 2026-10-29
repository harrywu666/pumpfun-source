import type { FastifyInstance } from "fastify";

const invalidJsonBodyCode = "FST_ERR_CTP_INVALID_JSON_BODY";

function invalidJsonBody(message: string): SyntaxError & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new SyntaxError(message), {
    code: invalidJsonBodyCode,
    statusCode: 400,
  });
}

/**
 * JSON.parse keeps the last value for a repeated object name. The native API
 * must not accept a body whose effective value depends on which parser or
 * proxy reads it, so scan the already-validated JSON before returning it.
 */
function assertUniqueObjectNames(text: string): void {
  let index = 0;

  const skipWhitespace = () => {
    while (/\s/.test(text[index] ?? "")) index++;
  };

  const stringEnd = (start: number): number => {
    let cursor = start + 1;
    while (cursor < text.length) {
      if (text[cursor] === "\\") cursor += 2;
      else if (text[cursor++] === '"') return cursor;
    }
    throw invalidJsonBody("Unterminated JSON string");
  };

  const parseValue = (): void => {
    skipWhitespace();
    switch (text[index]) {
      case '"':
        index = stringEnd(index);
        return;
      case "{":
        parseObject();
        return;
      case "[":
        parseArray();
        return;
      default:
        while (index < text.length && !/[\s,\]}]/.test(text[index] as string))
          index++;
    }
  };

  const parseObject = (): void => {
    index++;
    skipWhitespace();
    if (text[index] === "}") {
      index++;
      return;
    }
    const names = new Set<string>();
    while (index < text.length) {
      skipWhitespace();
      const end = stringEnd(index);
      const name = JSON.parse(text.slice(index, end)) as string;
      if (names.has(name))
        throw invalidJsonBody(`Duplicate JSON object name: ${name}`);
      names.add(name);
      index = end;
      skipWhitespace();
      index++;
      parseValue();
      skipWhitespace();
      if (text[index++] === "}") return;
    }
    throw invalidJsonBody("Unterminated JSON object");
  };

  const parseArray = (): void => {
    index++;
    skipWhitespace();
    if (text[index] === "]") {
      index++;
      return;
    }
    while (index < text.length) {
      parseValue();
      skipWhitespace();
      if (text[index++] === "]") return;
    }
    throw invalidJsonBody("Unterminated JSON array");
  };

  parseValue();
  skipWhitespace();
  if (index !== text.length) throw invalidJsonBody("Invalid JSON body");
}

export function parseJsonBody(text: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw invalidJsonBody(
      error instanceof Error ? error.message : "Invalid JSON body",
    );
  }
  assertUniqueObjectNames(text);
  return value;
}

/** Descendant native routes inherit this parser without changing fixture replay. */
export function useStrictJsonBodyParser(app: FastifyInstance): void {
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, body, done) => {
      try {
        if (typeof body !== "string")
          throw invalidJsonBody("JSON body was not decoded as text");
        done(null, parseJsonBody(body));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );
}
