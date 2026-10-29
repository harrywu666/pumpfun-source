import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { parse } from "@babel/parser";

const LOCAL_DOC_ROUTES = new Set([
  "/docs/fees",
  "/docs/privacy-policy",
  "/docs/terms-and-conditions",
]);
const OFFICIAL_DOC_ORIGIN = "https://pump.fun";

function menuEntries(ast, variableName) {
  const declaration = ast.program.body.find(
    (node) =>
      node.type === "ExportNamedDeclaration" &&
      node.declaration?.type === "VariableDeclaration" &&
      node.declaration.declarations.some(
        (declarator) =>
          declarator.id.type === "Identifier" &&
          declarator.id.name === variableName,
      ),
  );
  assert.ok(declaration, `${variableName} declaration is missing`);
  const declarator = declaration.declaration.declarations.find(
    (candidate) =>
      candidate.id.type === "Identifier" && candidate.id.name === variableName,
  );
  assert.equal(
    declarator?.init?.type,
    "ArrayExpression",
    `${variableName} must be an array`,
  );

  return declarator.init.elements.map((element, index) => {
    assert.equal(
      element?.type,
      "ObjectExpression",
      `${variableName}[${index}] must be an object`,
    );
    const entry = {};
    for (const property of element.properties) {
      assert.equal(
        property.type,
        "ObjectProperty",
        `${variableName}[${index}] has a spread`,
      );
      assert.equal(
        property.computed,
        false,
        `${variableName}[${index}] has a computed key`,
      );
      const key =
        property.key.type === "Identifier"
          ? property.key.name
          : property.key.value;
      if (
        typeof property.value.value === "string" ||
        typeof property.value.value === "boolean"
      ) {
        entry[key] = property.value.value;
      }
    }
    return entry;
  });
}

function documentationRoute(link) {
  if (link.href?.startsWith("/docs/")) return link.href;
  if (link.href?.startsWith(`${OFFICIAL_DOC_ORIGIN}/docs/`)) {
    return new URL(link.href).pathname;
  }
  return undefined;
}

test("footer documentation links preserve the local archive boundary", async () => {
  const source = await readFile(
    new URL("../packages/frontend/src/config/navigation.ts", import.meta.url),
    "utf8",
  );
  const ast = parse(source, { sourceType: "module", plugins: ["typescript"] });
  const documentationLinks = [
    ...menuEntries(ast, "RESOURCE_LINKS"),
    ...menuEntries(ast, "LEGAL_LINKS"),
  ].filter((link) => documentationRoute(link));
  const localLinks = documentationLinks.filter((link) =>
    LOCAL_DOC_ROUTES.has(documentationRoute(link)),
  );
  const externalLinks = documentationLinks.filter(
    (link) => !LOCAL_DOC_ROUTES.has(documentationRoute(link)),
  );

  assert.deepEqual(
    localLinks.map((link) => link.href).sort(),
    [...LOCAL_DOC_ROUTES].sort(),
  );
  for (const route of LOCAL_DOC_ROUTES) {
    assert.ok(
      existsSync(
        fileURLToPath(
          new URL(
            `../packages/frontend/src/app${route}/page.tsx`,
            import.meta.url,
          ),
        ),
      ),
      `${route} must have a reconstructed page before it can stay local`,
    );
  }

  for (const link of localLinks) {
    assert.equal(
      link.external,
      undefined,
      `${link.label} should stay internal`,
    );
  }
  for (const link of externalLinks) {
    const route = documentationRoute(link);
    assert.equal(
      link.href,
      `${OFFICIAL_DOC_ORIGIN}${route}`,
      `${link.label} must retain the official documentation origin`,
    );
    assert.equal(link.external, true, `${link.label} must open externally`);
  }
});
