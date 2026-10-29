#!/usr/bin/env node
/**
 * Visual parity of the app shell: captured reference vs. the local frontend.
 *
 * Reference: the captured server-rendered HTML of each route, served offline with
 * its captured CSS, fonts and images. Every captured <script> is removed and
 * captured JavaScript is never served, so no original code runs. React's streamed
 * segments are placed by a local DOM helper for statically recorded $RS/$RC/$RR
 * boundaries after DOMContentLoaded and retained stylesheet loading. Signed-out
 * and overlay-closed display branches are explicit emulations; captured consent
 * and authentication state are unknown.
 *
 * Local: the running frontend (`next start`), same viewport and state.
 *
 * Both renders get identical masks: animations off, page content hidden behind a
 * fixed-height container (this measures the shell, not page bodies). Surfaces
 * excluded by app/AGENTS.md (mobile-app promotion banner, "Get the app") are
 * removed from the reference only. Screenshots and a pixel diff are written to
 * --out with a JSON report. Requires Google Chrome and the pinned @babel/parser.
 *
 *   node scripts/shell-parity.mjs --local http://127.0.0.1:3000 --out qualification/shell
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parse } from "@babel/parser";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const VIEWPORTS = {
  desktop: { width: 1440, height: 900, mobile: false },
  mobile: { width: 390, height: 844, mobile: true },
};
const CASES = [
  { state: "overlay-closed-emulation", route: "/" },
  { state: "overlay-closed-emulation", route: "/explore" },
  { state: "ssr-overlay-present", route: "/" },
];
/** A pixel differs when any channel differs by more than this (absorbs anti-aliasing). */
const CHANNEL_TOLERANCE = 24;
const CELL = 16;

const MASK_BOTH = `
*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}
.pump-page-container>*{display:none!important}
.pump-page-container{min-height:600px!important}
#main-content>.page-container>*{display:none!important}
#main-content>.page-container{min-height:600px!important}
[data-clickwrap-overlay]>div>:first-child{visibility:hidden!important}
`;
const MASK_REFERENCE = `
#appsflyer-smart-banner-host+.max-md\\:hidden{display:none!important}
li:has(>[data-testid=try-app-button-sidebar]){display:none!important}
`;

const REPLAY = `(function(ops){
function rs(s,p){s=document.getElementById(s);p=document.getElementById(p);if(!s||!p)return;s.parentNode.removeChild(s);while(s.firstChild)p.parentNode.insertBefore(s.firstChild,p);p.parentNode.removeChild(p);}
function rc(b,s){s=document.getElementById(s);if(!s)return;s.parentNode.removeChild(s);var t=document.getElementById(b);if(!t)return;var start=t.previousSibling,parent=start.parentNode,n=start.nextSibling,depth=0;do{if(n&&n.nodeType===8){var d=n.data;if(d==='/$'){if(depth===0)break;depth--;}else if(d==='$'||d==='$?'||d==='$!')depth++;}var next=n.nextSibling;parent.removeChild(n);n=next;}while(n);while(s.firstChild)parent.insertBefore(s.firstChild,n);start.data='$';}
ops.forEach(function(o){o[0]==='S'?rs(o[1],o[2]):rc(o[1],o[2]);});
})`;

function recordedSegments(html) {
  const ops = [],
    styles = new Set();
  let scripts = 0;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (
      [
        "FunctionExpression",
        "FunctionDeclaration",
        "ArrowFunctionExpression",
      ].includes(node.type)
    )
      return;
    if (
      node.type === "CallExpression" &&
      node.callee.type === "Identifier" &&
      ["$RS", "$RC", "$RR"].includes(node.callee.name)
    ) {
      const [target, source, resources] = node.arguments;
      if (
        target?.type === "StringLiteral" &&
        source?.type === "StringLiteral" &&
        /^[A-Z]:\d+$/.test(target.value) &&
        /^[A-Z]:\d+$/.test(source.value)
      ) {
        if (node.callee.name === "$RR") {
          if (resources?.type !== "ArrayExpression")
            throw new Error("Unsupported retained resource gate");
          for (const resource of resources.elements) {
            const href =
              resource?.type === "ArrayExpression"
                ? resource.elements[0]
                : null;
            if (
              href?.type !== "StringLiteral" ||
              !/^\/_next\/static\/immutable\/chunks\/[a-zA-Z0-9_.-]+\.css$/.test(
                href.value,
              )
            )
              throw new Error("Unsupported retained stylesheet gate");
            styles.add(href.value);
          }
        }
        ops.push([
          node.callee.name === "$RS" ? "S" : "C",
          target.value,
          source.value,
        ]);
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  };
  for (const match of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
  )) {
    scripts++;
    if (
      !match[2].trim() ||
      /type=["']application\/(?:ld\+)?json["']/i.test(match[1])
    )
      continue;
    visit(parse(match[2], { sourceType: "unambiguous" }));
  }
  return { ops, styles: [...styles], removedScripts: scripts };
}

function referenceHtml(html, state) {
  const { ops, styles } = recordedSegments(html);
  const stripped = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const attributes =
    state === "overlay-closed-emulation"
      ? ' data-pf-auth="out" data-clickwrap-accepted=""'
      : ' data-pf-auth="out"';
  // Replacer functions: the replay source contains `$'`, which a replacement string would expand.
  return stripped
    .replace(/<html\b/, () => `<html${attributes}`)
    .replace(
      "</body>",
      () => `<script nonce="shell-reference-replay">document.addEventListener('DOMContentLoaded',async function(){try{
      await Promise.all(${JSON.stringify(styles)}.map(function(href){var links=Array.from(document.querySelectorAll('link[rel="stylesheet"]'));if(links.some(function(l){return l.getAttribute('href')===href&&l.sheet;}))return;
      return new Promise(function(ok,fail){var l=document.createElement('link');l.rel='stylesheet';l.href=href;l.onload=ok;l.onerror=function(){fail(Error('Retained stylesheet failed: '+href));};document.head.appendChild(l);});}));
      ${REPLAY}(${JSON.stringify(ops)});document.documentElement.setAttribute('data-shell-reference-ready','');
      }catch(e){document.documentElement.setAttribute('data-shell-reference-error',String(e));}},{once:true});</script></body>`,
    );
}

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const servedReferenceInputs = new Map();

function startReferenceServer(state) {
  const manifest = JSON.parse(
    readFileSync(join(ROOT, "evidence/web/manifest.json"), "utf8"),
  );
  const byPath = new Map();
  for (const record of manifest.records) {
    if (record.status === 200) {
      const path = resolve(ROOT, record.path);
      if (!path.startsWith(join(ROOT, "evidence/web/objects") + "/"))
        throw new Error("Unsafe retained asset path");
      const bytes = readFileSync(path);
      if (sha(bytes) !== record.sha256 || bytes.length !== record.bytes)
        throw new Error(`Retained asset mismatch: ${record.path}`);
      byPath.set(new URL(record.url).pathname, record);
    }
  }
  const server = createServer((request, response) => {
    const record = byPath.get(
      new URL(request.url, "http://reference").pathname,
    );
    const type = record?.headers["content-type"] ?? "";
    if (!record || type.includes("javascript")) {
      response.writeHead(404).end();
      return;
    }
    let body = readFileSync(join(ROOT, record.path));
    if (sha(body) !== record.sha256 || body.length !== record.bytes)
      throw new Error(`Retained asset changed: ${record.path}`);
    servedReferenceInputs.set(record.path, {
      url: record.url,
      sha256: record.sha256,
      bytes: record.bytes,
    });
    if (type.startsWith("text/html"))
      body = Buffer.from(referenceHtml(body.toString("utf8"), state));
    response
      .writeHead(200, {
        "content-type": type,
        "content-security-policy":
          "default-src 'self' data: blob:; script-src 'nonce-shell-reference-replay'; style-src 'self' 'unsafe-inline'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'",
      })
      .end(body);
  });
  return new Promise((ready) =>
    server.listen(0, "127.0.0.1", () => ready(server)),
  );
}

class Cdp {
  #id = 0;
  #pending = new Map();
  #listeners = new Map();
  constructor(socket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.#pending.get(message.id);
        this.#pending.delete(message.id);
        if (message.error)
          pending.reject(
            new Error(`${pending.method}: ${message.error.message}`),
          );
        else pending.resolve(message.result);
      } else {
        for (const listener of this.#listeners.get(
          `${message.sessionId ?? ""}:${message.method}`,
        ) ?? [])
          listener(message.params);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.#id;
    this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) =>
      this.#pending.set(id, { resolve, reject, method }),
    );
  }
  once(method, sessionId) {
    const key = `${sessionId ?? ""}:${method}`;
    return new Promise((resolve) => {
      const listener = (params) => {
        this.#listeners.set(
          key,
          (this.#listeners.get(key) ?? []).filter((l) => l !== listener),
        );
        resolve(params);
      };
      this.#listeners.set(key, [...(this.#listeners.get(key) ?? []), listener]);
    });
  }
}

async function launchChrome(chrome) {
  const profile = mkdtempSync(join(tmpdir(), "shell-parity-"));
  let child;
  let socket;
  try {
    child = spawn(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        "--no-default-browser-check",
        ...(process.platform === "linux" ? ["--no-sandbox"] : []),
        "--force-device-scale-factor=1",
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    const endpoint = await new Promise((found, failed) => {
      let output = "";
      child.stderr.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) found(match[1]);
      });
      child.on("exit", () =>
        failed(
          new Error(`Chrome exited before DevTools was ready:\n${output}`),
        ),
      );
    });
    socket = new WebSocket(endpoint);
    await new Promise((open, failed) => {
      socket.addEventListener("open", open, { once: true });
      socket.addEventListener(
        "error",
        () => failed(new Error("Chrome DevTools WebSocket connection failed")),
        { once: true },
      );
    });
    return {
      cdp: new Cdp(socket),
      close: async () => {
        socket.close();
        const exited = new Promise((done) => child.once("exit", done));
        child.kill();
        await exited; // Chrome writes to its profile until it exits
        rmSync(profile, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        });
      },
    };
  } catch (error) {
    socket?.close();
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((done) => child.once("exit", done));
      child.kill();
      await exited;
    }
    rmSync(profile, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    throw error;
  }
}

async function evaluate(cdp, sessionId, expression) {
  const { result, exceptionDetails } = await cdp.send(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (exceptionDetails)
    throw new Error(
      exceptionDetails.exception?.description ?? exceptionDetails.text,
    );
  return result.value;
}

async function capture(
  cdp,
  { url, viewport, cookies = [], css, requireShell = false },
) {
  const { targetId } = await cdp.send("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  try {
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Network.enable", {}, sessionId);
    // Targets share a browser cookie jar: every declared display case starts fresh.
    await cdp.send("Network.clearBrowserCookies", {}, sessionId);
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { ...viewport, deviceScaleFactor: 1 },
      sessionId,
    );
    for (const cookie of cookies)
      await cdp.send("Network.setCookie", { ...cookie, url }, sessionId);
    const loaded = cdp.once("Page.loadEventFired", sessionId);
    await cdp.send("Page.navigate", { url }, sessionId);
    await loaded;
    await evaluate(
      cdp,
      sessionId,
      `(async () => {
      const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style);
      if (${requireShell}) { for (let i=0;i<250&&!document.documentElement.hasAttribute('data-shell-reference-ready');i++) {
        const error=document.documentElement.getAttribute('data-shell-reference-error');if(error)throw new Error(error);
        await new Promise(r=>setTimeout(r,20));
      } if(!document.documentElement.hasAttribute('data-shell-reference-ready'))throw new Error('Reference segment placement did not finish'); }
      await document.fonts.ready; await new Promise((r) => setTimeout(r, 400));
      if (${requireShell} && !document.querySelector('[data-app-shell]')?.getClientRects().length) throw new Error('Reference shell is absent or still hidden; refusing a blank comparison');
      return true; })()`,
    );
    const { data } = await cdp.send(
      "Page.captureScreenshot",
      { format: "png" },
      sessionId,
    );
    return data;
  } finally {
    await cdp.send("Target.closeTarget", { targetId });
  }
}

/** Pixel diff in the browser's canvas; returns counts, merged regions and a diff image. */
async function diff(cdp, reference, local) {
  const { targetId } = await cdp.send("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  try {
    return await evaluate(
      cdp,
      sessionId,
      `(async () => {
      const load = (b64) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = 'data:image/png;base64,' + b64; });
      const [a, b] = await Promise.all([load(${JSON.stringify(reference)}), load(${JSON.stringify(local)})]);
      const w = Math.max(a.width, b.width), h = Math.max(a.height, b.height);
      const pixels = (img) => { const c = new OffscreenCanvas(w, h), x = c.getContext('2d'); x.fillStyle = '#ff00ff'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
      const pa = pixels(a), pb = pixels(b);
      const out = new OffscreenCanvas(w, h), ox = out.getContext('2d'); ox.globalAlpha = 0.25; ox.drawImage(a, 0, 0); ox.globalAlpha = 1;
      const marks = ox.getImageData(0, 0, w, h), md = marks.data;
      const cols = Math.ceil(w / ${CELL}), rows = Math.ceil(h / ${CELL}), cells = new Uint32Array(cols * rows);
      let differing = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2])) > ${CHANNEL_TOLERANCE}) {
          differing++; md[i] = 255; md[i + 1] = 0; md[i + 2] = 0; md[i + 3] = 255;
          cells[Math.floor(y / ${CELL}) * cols + Math.floor(x / ${CELL})]++;
        }
      }
      ox.putImageData(marks, 0, 0);
      const seen = new Uint8Array(cols * rows), regions = [];
      for (let s = 0; s < cells.length; s++) {
        if (!cells[s] || seen[s]) continue;
        const stack = [s]; seen[s] = 1; let x0 = cols, y0 = rows, x1 = 0, y1 = 0, count = 0;
        while (stack.length) {
          const c = stack.pop(), cx = c % cols, cy = (c - cx) / cols; count += cells[c];
          x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
          for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nx = cx + dx, ny = cy + dy, n = ny * cols + nx;
            if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && cells[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
          }
        }
        regions.push({ x: x0 * ${CELL}, y: y0 * ${CELL}, width: (x1 - x0 + 1) * ${CELL}, height: (y1 - y0 + 1) * ${CELL}, pixels: count });
      }
      regions.sort((p, q) => q.pixels - p.pixels);
      const blob = await out.convertToBlob({ type: 'image/png' });
      const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { width: w, height: h, sameSize: a.width === b.width && a.height === b.height, differingPixels: differing,
               differingRatio: differing / (w * h), regions: regions.slice(0, 12), diffPng: btoa(binary) };
    })()`,
    );
  } finally {
    await cdp.send("Target.closeTarget", { targetId });
  }
}

function slug(route) {
  return route === "/" ? "home" : route.replace(/^\//, "").replaceAll("/", "-");
}

async function main() {
  const { values } = parseArgs({
    options: {
      local: { type: "string", default: "http://127.0.0.1:3000" },
      out: { type: "string", default: "qualification/shell" },
      chrome: {
        type: "string",
        default: process.env.CHROME_PATH ?? DEFAULT_CHROME,
      },
      source: { type: "string", default: "packages/frontend" },
    },
  });
  const out = resolve(ROOT, values.out);
  const sourceRoot = resolve(ROOT, values.source);
  const localOrigin = new URL(values.local);
  if (
    localOrigin.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(localOrigin.hostname) ||
    localOrigin.username ||
    localOrigin.password
  ) {
    throw new Error("--local must be a credential-free loopback HTTP app");
  }
  mkdirSync(out, { recursive: true });
  const servers = {
    "overlay-closed-emulation": await startReferenceServer(
      "overlay-closed-emulation",
    ),
    "ssr-overlay-present": await startReferenceServer("ssr-overlay-present"),
  };
  const browser = await launchChrome(values.chrome);
  const results = [];
  try {
    for (const { state, route } of CASES) {
      const referenceUrl = `http://127.0.0.1:${servers[state].address().port}${route}`;
      const localUrl = new URL(route, values.local).href;
      const cookies =
        state === "overlay-closed-emulation"
          ? [{ name: "clickwrap_accepted", value: "true" }]
          : [];
      for (const [name, viewport] of Object.entries(VIEWPORTS)) {
        const reference = await capture(browser.cdp, {
          url: referenceUrl,
          viewport,
          css: MASK_BOTH + MASK_REFERENCE,
          requireShell: true,
        });
        const local = await capture(browser.cdp, {
          url: localUrl,
          viewport,
          cookies,
          css: MASK_BOTH,
        });
        const { diffPng, ...measured } = await diff(
          browser.cdp,
          reference,
          local,
        );
        const base = `${state}-${slug(route)}-${name}`;
        writeFileSync(
          join(out, `${base}-reference.png`),
          Buffer.from(reference, "base64"),
        );
        writeFileSync(
          join(out, `${base}-local.png`),
          Buffer.from(local, "base64"),
        );
        writeFileSync(
          join(out, `${base}-diff.png`),
          Buffer.from(diffPng, "base64"),
        );
        results.push({
          state,
          route,
          viewport: name,
          ...viewport,
          ...measured,
          files: [
            `${base}-reference.png`,
            `${base}-local.png`,
            `${base}-diff.png`,
          ],
        });
        console.log(
          `${base.padEnd(32)} differing ${(measured.differingRatio * 100).toFixed(2).padStart(6)}%  (${measured.differingPixels} px, ${measured.regions.length} regions)`,
        );
      }
    }
  } finally {
    await browser.close();
    for (const server of Object.values(servers)) server.close();
  }
  const report = {
    scope:
      "Bounded shell comparison: retained SSR with explicitly emulated display states vs. local frontend at identical viewports.",
    method: {
      reference:
        "Hash-checked captured HTML with every <script> removed and captured JS unserved. Only the local, nonce-bound segment-placement helper runs. CSP blocks remote assets/connections and captured active content. The signed-out display attribute is applied explicitly; overlay-closed-emulation also applies the accepted-display attribute. These are controlled display branches, not a claim about the captured visitor session/cookies.",
      segmentPlacement:
        "Babel parses literal top-level $RS/$RC calls and $RR stylesheet-gated boundaries, ignoring strings and function bodies. The local renderer awaits the recorded captured stylesheets, then moves only the named retained DOM segments after DOMContentLoaded.",
      local: values.local,
      cookieIsolation:
        "Network.clearBrowserCookies before each reference/local capture, followed only by the declared display-case cookies; the browser profile is newly created for this run.",
      declaredLocalSourceDirectory: sourceRoot,
      masksBothRenders: MASK_BOTH.trim().split("\n"),
      excludedFromReferenceOnly: MASK_REFERENCE.trim().split("\n"),
      channelTolerance: CHANNEL_TOLERANCE,
      regionCellPixels: CELL,
    },
    limits: [
      "Measures the shell around a masked page body; page bodies and live data are not compared.",
      "The reference is server-rendered HTML without client hydration, i.e. the first-paint state.",
      "Pixel equality is a visual check, not DOM, behavior or accessibility equivalence.",
      "The local placement helper waits for DOMContentLoaded so every named retained segment has been parsed; every reference capture requires a visible shell.",
      "Captured browser consent/auth state is unknown. Overlay-closed emulation is separate from the unclosed SSR overlay case; local browser consent behavior is source-specific and does not establish current legal authority.",
    ],
    referenceInputs: Object.fromEntries(
      [...servedReferenceInputs].sort(([a], [b]) => a.localeCompare(b)),
    ),
    localSourceSha256: Object.fromEntries(
      [
        "src/app/layout.tsx",
        "src/app/app-shell.tsx",
        "src/app/globals.css",
        "src/app/captured-shell.css",
        "src/components/shell/AppShell.tsx",
        "src/components/shell/AppSidebar.tsx",
        "src/components/shell/MobileNav.tsx",
        "src/components/shell/search/SearchDialog.tsx",
        "src/components/ui/sidebar.tsx",
        "src/config/navigation.ts",
      ].map((path) => [path, sha(readFileSync(join(sourceRoot, path)))]),
    ),
    harnessSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
    browserExecutableSha256: sha(readFileSync(values.chrome)),
    nodeVersion: process.version,
    results,
  };
  writeFileSync(
    join(out, "parity.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}

export { recordedSegments, referenceHtml, startReferenceServer };
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
