import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareVideo,
  validateVideo,
  coverTimes,
  VIDEO_BYTES,
  VideoDraftSession,
  discardVideoCover,
} from "../packages/frontend/src/app/create-video-preview.ts";
import { validateImage } from "../packages/frontend/src/app/create-coin-validation.ts";

// Decoder doubles exercise lifecycle, not MP4/WebM decoding or browser compatibility.
const file = (name = "example.mp4", type = "video/mp4", bytes = 8) =>
  new File([new Uint8Array(bytes)], name, { type });
const tick = () => new Promise((resolve) => setImmediate(resolve));
function platform(options = {}) {
  const active = new Map(),
    revoked = [],
    seeks = [],
    draws = [],
    listeners = new Map();
  const encoded = [];
  let id = 0;
  class Video extends EventTarget {
    src = "";
    duration = options.duration ?? 8;
    videoWidth = options.width ?? 1920;
    videoHeight = options.height ?? 1080;
    paused = 0;
    loads = 0;
    addEventListener(name, fn, opts) {
      super.addEventListener(name, fn, opts);
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    }
    removeEventListener(name, fn, opts) {
      super.removeEventListener(name, fn, opts);
      listeners.get(name)?.delete(fn);
    }
    load() {
      this.loads++;
      if (this.src && options.wait !== "metadata")
        queueMicrotask(() =>
          this.dispatchEvent(
            new Event(
              options.error === "metadata" ? "error" : "loadedmetadata",
            ),
          ),
        );
    }
    pause() {
      this.paused++;
    }
    removeAttribute(name) {
      if (name === "src") this.src = "";
    }
    set currentTime(value) {
      seeks.push(value);
      if (options.wait !== "seek")
        queueMicrotask(() =>
          this.dispatchEvent(
            new Event(
              options.error === "seek" || seeks.length === options.errorSeekAt
                ? "error"
                : "seeked",
            ),
          ),
        );
    }
  }
  const video = new Video();
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return options.noContext
        ? null
        : {
            drawImage(...args) {
              if (options.drawError) throw new Error("draw failed");
              draws.push(args.slice(1));
            },
          };
    },
    toBlob(callback, type, quality) {
      const blob =
        options.nullBlob || encoded.length + 1 === options.nullBlobAt
          ? null
          : new Blob([new Uint8Array(options.coverBytes ?? 3)], {
              type: options.coverType ?? type,
            });
      encoded.push({ callback, blob, type, quality });
      if (options.wait !== "encode" && encoded.length !== options.waitEncodeAt)
        queueMicrotask(() => callback(blob));
    },
  };
  return {
    active,
    revoked,
    seeks,
    draws,
    video,
    canvas,
    encoded,
    listenerCount: () =>
      [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
    api: {
      video: () => video,
      canvas: () => canvas,
      url(blob) {
        const url = `blob:synthetic-${++id}`;
        active.set(url, blob);
        return url;
      },
      revoke(url) {
        assert.ok(active.delete(url), `URL revoked exactly once: ${url}`);
        revoked.push(url);
      },
    },
  };
}

test("video file policy accepts observed extensions and size boundary, never authenticates MIME", () => {
  for (const [name, type] of [
    ["a.mp4", "video/mp4"],
    ["A.WEBM", "video/webm"],
    ["a.mp4", ""],
  ])
    assert.equal(validateVideo(file(name, type)), undefined);
  for (const [name, type] of [
    ["a.avi", "video/avi"],
    ["a.mp4", "video/webm"],
    ["a.webm", "image/png"],
    ["a.mp4.exe", "video/mp4"],
  ])
    assert.match(validateVideo(file(name, type)), /MP4 or WebM/);
  assert.match(validateVideo(file("a.mp4", "video/mp4", 0)), /non-empty/);
  assert.equal(
    validateVideo(file("a.mp4", "video/mp4", VIDEO_BYTES)),
    undefined,
  );
  assert.match(
    validateVideo(file("a.mp4", "video/mp4", VIDEO_BYTES + 1)),
    /10 MB/,
  );
});
test("quarter-duration points reject unusable durations, including underflow", () => {
  assert.deepEqual(coverTimes(8), [2, 4, 6]);
  assert.deepEqual(coverTimes(0.004), [0.001, 0.002, 0.003]);
  for (const invalid of [0, -1, Infinity, -Infinity, NaN, Number.MIN_VALUE])
    assert.throws(() => coverTimes(invalid), /duration/);
});
test("three JPEG covers use observed points/quality, fit bounded canvas and pass existing image validation", async () => {
  const p = platform(),
    controller = new AbortController();
  const result = await prepareVideo(file(), controller.signal, p.api);
  assert.deepEqual(p.seeks, [2, 4, 6]);
  assert.deepEqual(p.draws, Array(3).fill([0, 0, 1280, 720]));
  assert.deepEqual(
    p.encoded.map((x) => [x.type, x.quality]),
    Array(3).fill(["image/jpeg", 0.8]),
  );
  assert.equal(result.covers.length, 3);
  for (const cover of result.covers)
    assert.equal(validateImage(cover.file), undefined);
  assert.equal(p.active.size, 4);
  assert.equal(p.listenerCount(), 0);
  assert.equal(p.video.src, "");
  assert.equal(p.video.paused, 1);
  assert.equal(p.canvas.width, 0);
  assert.equal(p.canvas.height, 0);
  result.dispose();
  result.dispose();
  controller.abort();
  assert.equal(p.active.size, 0);
  assert.equal(p.revoked.length, 4);
});
test("small video is not enlarged and post-resolution abort releases every preview URL", async () => {
  const p = platform({ width: 16, height: 9 }),
    controller = new AbortController();
  await prepareVideo(file(), controller.signal, p.api);
  assert.deepEqual(p.draws[0], [0, 0, 16, 9]);
  controller.abort();
  assert.equal(p.active.size, 0);
  assert.equal(p.revoked.length, 4);
});

for (const [label, options, pattern] of [
  ["unsupported codec", { error: "metadata" }, /decode/],
  ["seek failure", { error: "seek" }, /decode/],
  ["infinite duration", { duration: Infinity }, /duration/],
  ["zero duration", { duration: 0 }, /duration/],
  ["zero width", { width: 0 }, /dimensions/],
  ["invalid height", { height: NaN }, /dimensions/],
  ["pixel budget", { width: 8192, height: 8192 }, /dimensions/],
  ["no canvas", { noContext: true }, /cover images/],
  ["draw error", { drawError: true }, /draw failed/],
  ["null encoding", { nullBlob: true }, /encode/],
  ["empty encoding", { coverBytes: 0 }, /empty/],
  ["wrong encoding", { coverType: "image/png" }, /unsupported/],
  ["oversize cover", { coverBytes: 4_500_001 }, /4.5 MB/],
])
  test(`${label} rejects and releases decoder/listeners/URLs`, async () => {
    const p = platform(options);
    await assert.rejects(
      prepareVideo(file(), new AbortController().signal, p.api),
      pattern,
    );
    assert.equal(p.active.size, 0);
    assert.equal(p.listenerCount(), 0);
    assert.equal(p.video.src, "");
    assert.equal(p.video.paused, 1);
  });
for (const wait of ["metadata", "seek", "encode"]) {
  test(`abort during ${wait} cleans resources and late events cannot publish`, async () => {
    const p = platform({ wait }),
      controller = new AbortController();
    const result = prepareVideo(file(), controller.signal, p.api);
    await tick();
    controller.abort();
    await assert.rejects(result, { name: "AbortError" });
    p.video.dispatchEvent(new Event("seeked"));
    p.video.dispatchEvent(new Event("loadedmetadata"));
    for (const { callback, blob } of p.encoded) callback(blob);
    await tick();
    assert.equal(p.active.size, 0);
    assert.equal(p.listenerCount(), 0);
  });
  test(`timeout during ${wait} cleans resources`, async () => {
    const p = platform({ wait });
    await assert.rejects(
      prepareVideo(file(), new AbortController().signal, p.api, 20),
      /timed out/,
    );
    assert.equal(p.active.size, 0);
    assert.equal(p.listenerCount(), 0);
  });
}
test("already cancelled and invalid files allocate nothing", async () => {
  const p = platform(),
    controller = new AbortController();
  controller.abort();
  await assert.rejects(prepareVideo(file(), controller.signal, p.api), {
    name: "AbortError",
  });
  await assert.rejects(
    prepareVideo(file("bad.exe"), new AbortController().signal, p.api),
    /MP4/,
  );
  assert.equal(p.active.size, 0);
  assert.equal(p.video.loads, 0);
});

for (const [options, count] of [
  [{ nullBlobAt: 2 }, 2],
  [{ errorSeekAt: 3 }, 3],
  [{ waitEncodeAt: 2 }, 2],
])
  test(`partial preparation failure revokes source and ${count - 1} prior covers`, async () => {
    const p = platform(options);
    await assert.rejects(
      prepareVideo(file(), new AbortController().signal, p.api, 25),
    );
    assert.equal(p.active.size, 0);
    assert.equal(p.revoked.length, count);
    assert.equal(p.listenerCount(), 0);
  });

function controlledSession() {
  const pending = [],
    states = [],
    selected = [],
    removed = [],
    disposed = [];
  const prepare = (video, signal) =>
    new Promise((resolve, reject) =>
      pending.push({ video, signal, resolve, reject }),
    );
  const session = new VideoDraftSession(
    (s) => states.push(s),
    (s) => selected.push(s),
    (owner) => removed.push(owner),
    prepare,
  );
  const ready = (index) => {
    const item = pending[index];
    const preview = {
      file: item.video,
      url: `blob:video-${index}`,
      covers: [0, 1, 2].map((n) => ({
        file: new File(["jpeg"], `cover-${n}.jpg`, { type: "image/jpeg" }),
        url: `blob:cover-${index}-${n}`,
        seconds: n + 1,
      })),
      dispose() {
        disposed.push(preview);
      },
    };
    item.resolve(preview);
    return preview;
  };
  return { session, pending, states, selected, removed, disposed, ready };
}
test("successful session selects first cover, then an explicit cover; replacement releases old resources", async () => {
  const p = controlledSession();
  const first = p.session.choose(file());
  const a = p.ready(0);
  await first;
  assert.equal(p.selected[0].cover, a.covers[0].file);
  p.session.select(2);
  assert.equal(p.selected[1].cover, a.covers[2].file);
  for (const invalid of [-1, 3, NaN, 1.5]) p.session.select(invalid);
  assert.equal(p.selected.length, 2);
  const second = p.session.choose(file("two.webm", "video/webm"));
  const b = p.ready(1);
  await second;
  assert.deepEqual(p.disposed, [a]);
  assert.equal(p.selected.at(-1).owner, b);
  p.session.clear();
  assert.deepEqual(p.removed, [b]);
  assert.deepEqual(p.disposed, [a, b]);
});
test("rejected replacement preserves prior video and never clears a manual image", async () => {
  const p = controlledSession();
  const first = p.session.choose(file());
  const a = p.ready(0);
  await first;
  const second = p.session.choose(file("broken.mp4"));
  p.pending[1].reject(new Error("unsupported codec"));
  await second;
  assert.equal(p.states.at(-1).preview, a);
  assert.equal(p.states.at(-1).pending, false);
  assert.match(p.states.at(-1).error, /unsupported codec/);
  assert.equal(p.selected.length, 1);
  assert.equal(p.removed.length, 0);
  assert.equal(p.disposed.length, 0);
  const manual = {
    file: new File(["image"], "manual.png"),
    videoOwner: undefined,
  };
  assert.equal(discardVideoCover(manual, a), manual);
  assert.equal(discardVideoCover({ videoOwner: a }, a), null);
  assert.equal(discardVideoCover(null, a), null);
});
test("manual image selection cancels a pending replacement and detaches the committed cover", async () => {
  const p = controlledSession();
  const first = p.session.choose(file());
  const a = p.ready(0);
  await first;
  const pending = p.session.choose(file("new.mp4"));
  p.session.detachCover();
  assert.equal(p.pending[1].signal.aborted, true);
  const b = p.ready(1);
  await pending;
  assert.equal(p.states.at(-1).preview, a);
  assert.equal(p.states.at(-1).selected, null);
  assert.equal(p.states.at(-1).pending, false);
  assert.deepEqual(p.disposed, [b]);
  assert.equal(p.removed.length, 0);
  p.session.select(2);
  assert.equal(p.selected.at(-1).cover, a.covers[2].file);
});
test("late replaced decode is discarded, not selected or allowed to remove newer cover", async () => {
  const p = controlledSession();
  const first = p.session.choose(file());
  const second = p.session.choose(file("new.mp4"));
  assert.equal(p.pending[0].signal.aborted, true);
  const b = p.ready(1);
  await second;
  const a = p.ready(0);
  await first;
  assert.deepEqual(p.disposed, [a]);
  assert.deepEqual(
    p.selected.map((s) => s.owner),
    [b],
  );
  const current = { videoOwner: b };
  assert.equal(discardVideoCover(current, a), current);
});
for (const action of ["cancelPending", "clear", "dispose"])
  test(`${action} makes late decode stale and leaves manual selection untouched`, async () => {
    const p = controlledSession();
    const work = p.session.choose(file());
    p.session[action]();
    assert.equal(p.pending[0].signal.aborted, true);
    const old = p.ready(0);
    await work;
    assert.deepEqual(p.disposed, [old]);
    assert.equal(p.selected.length, 0);
    assert.equal(p.removed.length, 0);
    if (action === "dispose") {
      const length = p.states.length;
      await p.session.choose(file());
      p.session.clear();
      p.session.select(0);
      assert.equal(p.states.length, length);
    }
  });
test("unmount disposal releases committed preview without callbacks into unmounted parent", async () => {
  const p = controlledSession();
  const work = p.session.choose(file());
  const a = p.ready(0);
  await work;
  const count = p.states.length;
  p.session.dispose();
  p.session.dispose();
  assert.deepEqual(p.disposed, [a]);
  assert.equal(p.states.length, count);
  assert.equal(p.removed.length, 0);
});

test("explicit existing-cover selection supersedes a pending video replacement", async () => {
  const p = controlledSession();
  const first = p.session.choose(file());
  const a = p.ready(0);
  await first;
  const pending = p.session.choose(file("new.mp4"));
  p.session.select(1);
  assert.equal(p.pending[1].signal.aborted, true);
  assert.equal(p.selected.at(-1).cover, a.covers[1].file);
  const b = p.ready(1);
  await pending;
  assert.deepEqual(p.disposed, [b]);
  assert.equal(p.states.at(-1).preview, a);
});
