import { createNotificationActions } from "../packages/frontend/src/lib/notification-actions.ts";
import assert from "node:assert/strict";
import test from "node:test";
import {
  createNotificationController,
  preferenceControl,
  topicControl,
  type NotificationAdapter,
} from "../packages/frontend/src/lib/notification-controller.ts";
import {
  PREFERENCE_FIELDS,
  mergePreferencePatch,
  preferenceValue,
  readPreferenceSnapshot,
  readTopicSnapshot,
  topicValue,
  type PreferencePatch,
} from "../packages/frontend/src/lib/notification-state.ts";
import { createSyntheticNotificationAdapter } from "./helpers/notification-test-adapter.ts";

function seed() {
  return {
    settings: {
      rootUnknown: { retainedInReadOnly: true },
      chat: {
        allowGroupNotifications: false,
        allowChatRequestNotifications: true,
        unknownChat: { array: [1, false, null] },
      },
      social: {
        allowDmMessageNotifications: true,
        allowFollowerNotifications: false,
        allowNewCoinNotifications: true,
        allowCoinWatcherNotifications: false,
        unknownSocial: "keep",
      },
      coins: {
        allowPriceSpikeNotifications: false,
        allowLiveStreamNotifications: true,
        allowCalloutNotifications: false,
        unknownCoins: ["keep"],
      },
    },
    topics: {
      rootUnknown: "keep",
      topicSubscriptions: {
        trending: { active: false, unknown: "keep" },
        trending_searches: { active: true },
      },
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup(overrides: Partial<NotificationAdapter> = {}) {
  const local = createSyntheticNotificationAdapter(seed());
  const adapter: NotificationAdapter = { ...local.adapter, ...overrides };
  return { ...local, controller: createNotificationController(adapter) };
}

test("default adapter remains unavailable, with no account defaults or effects", async () => {
  const controller = createNotificationController();
  assert.equal(controller.getSnapshot().adapterKind, "unavailable");
  assert.equal(controller.getSnapshot().settings.data, null);
  assert.equal(controller.getSnapshot().topics.data, null);
  for (const result of await Promise.all([
    controller.loadSettings(),
    controller.loadTopics(),
    controller.updateSettings({}),
    controller.setTopic("trending", "subscribe"),
  ])) {
    assert.deepEqual(result, { status: "ignored", reason: "unavailable" });
  }
});

test("missing data makes updates no-ops without constructing fake settings", async () => {
  const { controller, calls } = setup();
  assert.deepEqual(
    await controller.updateSettings({
      chat: { allowGroupNotifications: true },
    }),
    { status: "ignored", reason: "no-data" },
  );
  assert.deepEqual(await controller.setTopic("trending", "subscribe"), {
    status: "ignored",
    reason: "no-data",
  });
  assert.equal(mergePreferencePatch(null, {}), null);
  assert.deepEqual(calls, []);
});

test("all nine controls merge exactly three groups and retain unknown group fields", () => {
  const original = readPreferenceSnapshot(seed().settings);
  for (const group of ["chat", "social", "coins"] as const) {
    const fields = PREFERENCE_FIELDS[group];
    for (const field of fields) {
      const patch = {
        [group]: { [field]: !original[group][field] },
      } as PreferencePatch;
      const merged = mergePreferencePatch(original, patch)!;
      assert.deepEqual(Object.keys(merged).sort(), ["chat", "coins", "social"]);
      assert.equal(merged[group][field], !original[group][field]);
      for (const key of ["chat", "social", "coins"] as const) {
        for (const [name, value] of Object.entries(original[key])) {
          if (key !== group || name !== field)
            assert.deepEqual(merged[key][name], value);
        }
        assert.notEqual(merged[key], original[key]);
      }
    }
  }
  assert.deepEqual(original, seed().settings);
});

test("unknown/missing booleans are not rendered as off or source fallback true", () => {
  const settings = readPreferenceSnapshot({
    chat: {},
    social: { allowDmMessageNotifications: "true" },
    coins: {},
  });
  assert.deepEqual(
    preferenceValue(settings, "chat", "allowGroupNotifications"),
    { available: false },
  );
  assert.deepEqual(
    preferenceValue(settings, "social", "allowDmMessageNotifications"),
    { available: false },
  );
  assert.deepEqual(topicValue(null, "trending"), { available: false });
  assert.deepEqual(
    topicValue(readTopicSnapshot({ topicSubscriptions: {} }), "trending"),
    { available: false },
  );
  assert.deepEqual(
    topicValue(
      readTopicSnapshot({
        topicSubscriptions: { trending: { active: "yes" } },
      }),
      "trending",
    ),
    { available: false },
  );
  assert.deepEqual(topicValue(readTopicSnapshot(seed().topics), "trending"), {
    available: true,
    value: false,
  });
});

test("loading is visible and repeated reads/updates are blocked until data arrives", async () => {
  const waiting = deferred<unknown>();
  const { controller } = setup({ readSettings: () => waiting.promise });
  const operation = controller.loadSettings();
  assert.equal(controller.getSnapshot().settings.status, "loading");
  assert.equal(controller.getSnapshot().settings.data, null);
  assert.deepEqual(await controller.loadSettings(), {
    status: "ignored",
    reason: "busy",
  });
  assert.deepEqual(await controller.updateSettings({}), {
    status: "ignored",
    reason: "busy",
  });
  waiting.resolve(seed().settings);
  assert.deepEqual(await operation, { status: "completed" });
  assert.equal(controller.getSnapshot().settings.status, "ready");
});

test("submitted snapshot is committed only after success, ignoring response body", async () => {
  const waiting = deferred<unknown>();
  let submitted: unknown;
  const { controller } = setup({
    writeSettings: (value) => {
      submitted = value;
      return waiting.promise;
    },
  });
  await controller.loadSettings();
  const previous = controller.getSnapshot().settings.data;
  const operation = controller.updateSettings({
    social: { allowFollowerNotifications: true },
  });
  assert.equal(controller.getSnapshot().settingsMutation.status, "pending");
  assert.equal(controller.getSnapshot().settings.data, previous);
  assert.deepEqual(await controller.updateSettings({}), {
    status: "ignored",
    reason: "busy",
  });
  assert.deepEqual(await controller.loadSettings(), {
    status: "ignored",
    reason: "busy",
  });
  waiting.resolve({ differentServerBody: true });
  assert.deepEqual(await operation, { status: "completed" });
  assert.equal(controller.getSnapshot().settings.data, submitted);
  assert.equal(
    controller.getSnapshot().settings.data?.social.allowFollowerNotifications,
    true,
  );
  assert.equal(controller.getSnapshot().settings.data?.rootUnknown, undefined);
  assert.equal(controller.getSnapshot().settingsMutation.status, "idle");
});

test("write failure retains last committed preferences and a later retry succeeds", async () => {
  let fail = true;
  const { controller } = setup({
    writeSettings: async () => {
      if (fail) throw new Error("synthetic failure");
      return undefined;
    },
  });
  await controller.loadSettings();
  const previous = controller.getSnapshot().settings.data;
  assert.deepEqual(
    await controller.updateSettings({
      coins: { allowCalloutNotifications: true },
    }),
    { status: "failed", error: { kind: "adapter-failure" } },
  );
  assert.equal(controller.getSnapshot().settings.data, previous);
  assert.equal(controller.getSnapshot().settingsMutation.status, "error");
  fail = false;
  assert.deepEqual(
    await controller.updateSettings({
      coins: { allowCalloutNotifications: true },
    }),
    { status: "completed" },
  );
  assert.equal(
    controller.getSnapshot().settings.data?.coins.allowCalloutNotifications,
    true,
  );
  assert.equal(controller.getSnapshot().settingsMutation.error, null);
});

test("malformed reads fail closed; a failed refresh retains but marks old data stale", async () => {
  let response: unknown = seed().settings;
  const { controller, calls } = setup({ readSettings: async () => response });
  await controller.loadSettings();
  const previous = controller.getSnapshot().settings.data;
  response = { chat: {}, social: null, coins: {} };
  assert.deepEqual(await controller.loadSettings(), {
    status: "failed",
    error: { kind: "invalid-data" },
  });
  assert.equal(controller.getSnapshot().settings.data, previous);
  assert.equal(controller.getSnapshot().settings.stale, true);
  assert.deepEqual(await controller.updateSettings({}), {
    status: "ignored",
    reason: "no-data",
  });
  assert.deepEqual(calls, []);
  response = seed().settings;
  await controller.loadSettings();
  assert.equal(controller.getSnapshot().settings.stale, false);
});

test("unknown patch fields and non-boolean changes never reach an adapter", async () => {
  const { controller, calls } = setup();
  await controller.loadSettings();
  for (const patch of [
    { extra: {} },
    { chat: { invented: true } },
    { social: { allowFollowerNotifications: "true" } },
    { coins: null },
  ]) {
    assert.deepEqual(
      await controller.updateSettings(patch as PreferencePatch),
      { status: "failed", error: { kind: "invalid-input" } },
    );
  }
  assert.deepEqual(
    calls.map((call) => call.operation),
    ["readSettings"],
  );
});

test("topic success passes only topic, invalidates, then reloads; unknown topic fields survive", async () => {
  const { controller, calls } = setup();
  await controller.loadTopics();
  const transitions: unknown[] = [];
  const stop = controller.subscribe(() =>
    transitions.push(controller.getSnapshot().topics),
  );
  assert.deepEqual(await controller.setTopic("trending", "subscribe"), {
    status: "completed",
    refreshed: true,
  });
  stop();
  assert.deepEqual(calls, [
    { operation: "readTopics" },
    { operation: "subscribe", payload: { topic: "trending" } },
    { operation: "readTopics" },
  ]);
  assert.equal(
    transitions.some((value) => (value as { stale: boolean }).stale),
    true,
  );
  assert.deepEqual(
    topicValue(controller.getSnapshot().topics.data, "trending"),
    { available: true, value: true },
  );
  assert.deepEqual(
    controller.getSnapshot().topics.data?.topicSubscriptions.trending,
    { active: true, unknown: "keep" },
  );
  await controller.setTopic("trending", "unsubscribe");
  assert.deepEqual(
    topicValue(controller.getSnapshot().topics.data, "trending"),
    { available: true, value: false },
  );
});

test("topic pending prevents double submission and failure does not invalidate or fabricate success", async () => {
  const waiting = deferred<unknown>();
  const { controller, calls } = setup({ mutateTopic: () => waiting.promise });
  await controller.loadTopics();
  const previous = controller.getSnapshot().topics.data;
  const operation = controller.setTopic("trending", "subscribe");
  assert.equal(controller.getSnapshot().topicMutation.status, "pending");
  assert.deepEqual(await controller.setTopic("trending", "subscribe"), {
    status: "ignored",
    reason: "busy",
  });
  assert.deepEqual(await controller.loadTopics(), {
    status: "ignored",
    reason: "busy",
  });
  waiting.reject(new Error("synthetic failure"));
  assert.deepEqual(await operation, {
    status: "failed",
    error: { kind: "adapter-failure" },
  });
  assert.equal(controller.getSnapshot().topics.data, previous);
  assert.equal(controller.getSnapshot().topics.stale, false);
  assert.deepEqual(
    calls.map((call) => call.operation),
    ["readTopics"],
  );
});

test("successful topic mutation with failed re-read leaves stale/unknown data until explicit retry", async () => {
  let reads = 0;
  const { controller } = setup({
    readTopics: async () => {
      if (++reads === 2) throw new Error("synthetic read failure");
      return seed().topics;
    },
  });
  await controller.loadTopics();
  assert.deepEqual(await controller.setTopic("trending", "subscribe"), {
    status: "completed",
    refreshed: false,
  });
  assert.equal(controller.getSnapshot().topicMutation.status, "idle");
  assert.equal(controller.getSnapshot().topics.status, "error");
  assert.equal(controller.getSnapshot().topics.stale, true);
  assert.deepEqual(await controller.setTopic("trending", "unsubscribe"), {
    status: "ignored",
    reason: "no-data",
  });
  await controller.loadTopics();
  assert.equal(controller.getSnapshot().topics.stale, false);
});

test("independent settings/topics operations are allowed; each cache remains isolated", async () => {
  const { controller } = setup();
  await Promise.all([controller.loadSettings(), controller.loadTopics()]);
  assert.deepEqual(
    await Promise.all([
      controller.updateSettings({ chat: { allowGroupNotifications: true } }),
      controller.setTopic("trending", "subscribe"),
    ]),
    [{ status: "completed" }, { status: "completed", refreshed: true }],
  );
  assert.equal(
    controller.getSnapshot().settings.data?.chat.allowGroupNotifications,
    true,
  );
  assert.deepEqual(
    topicValue(controller.getSnapshot().topics.data, "trending"),
    { available: true, value: true },
  );
});

test("reset invalidates old reads and writes; stale completion cannot populate a new owner/view", async () => {
  const waiting = deferred<unknown>();
  const { controller } = setup({ readSettings: () => waiting.promise });
  const operation = controller.loadSettings();
  controller.reset();
  waiting.resolve(seed().settings);
  assert.deepEqual(await operation, {
    status: "ignored",
    reason: "superseded",
  });
  assert.equal(controller.getSnapshot().settings.data, null);

  const writing = deferred<unknown>();
  const second = setup({ writeSettings: () => writing.promise }).controller;
  await second.loadSettings();
  const update = second.updateSettings({});
  second.reset();
  writing.reject(new Error("late failure"));
  assert.deepEqual(await update, { status: "ignored", reason: "superseded" });
  assert.equal(second.getSnapshot().settingsMutation.status, "idle");
});

test("reset from a successful settings read publication returns superseded", async () => {
  const { controller } = setup();
  let reset = false;
  controller.subscribe(() => {
    if (!reset && controller.getSnapshot().settings.status === "ready") {
      reset = true;
      controller.reset();
    }
  });
  assert.deepEqual(await controller.loadSettings(), {
    status: "ignored",
    reason: "superseded",
  });
  assert.equal(controller.getSnapshot().settings.data, null);
});

test("reset from a successful settings write publication returns superseded", async () => {
  const { controller } = setup();
  await controller.loadSettings();
  let reset = false;
  controller.subscribe(() => {
    if (
      !reset &&
      controller.getSnapshot().settings.status === "ready" &&
      controller.getSnapshot().settingsMutation.status === "idle"
    ) {
      reset = true;
      controller.reset();
    }
  });
  assert.deepEqual(
    await controller.updateSettings({
      chat: { allowGroupNotifications: true },
    }),
    { status: "ignored", reason: "superseded" },
  );
  assert.equal(controller.getSnapshot().settings.data, null);
});

test("reset from a successful topic read publication returns superseded", async () => {
  const { controller } = setup();
  let reset = false;
  controller.subscribe(() => {
    if (!reset && controller.getSnapshot().topics.status === "ready") {
      reset = true;
      controller.reset();
    }
  });
  assert.deepEqual(await controller.loadTopics(), {
    status: "ignored",
    reason: "superseded",
  });
  assert.equal(controller.getSnapshot().topics.data, null);
});

test("reset from a successful topic refresh publication returns superseded", async () => {
  const { controller } = setup();
  await controller.loadTopics();
  let reset = false;
  controller.subscribe(() => {
    const state = controller.getSnapshot();
    if (
      !reset &&
      state.topics.status === "ready" &&
      !state.topics.stale &&
      state.topicMutation.status === "idle"
    ) {
      reset = true;
      controller.reset();
    }
  });
  assert.deepEqual(await controller.setTopic("trending", "subscribe"), {
    status: "ignored",
    reason: "superseded",
  });
  assert.equal(controller.getSnapshot().topics.data, null);
});

test("dispose drops subscribers and late topic completions without refresh or resurrection", async () => {
  const waiting = deferred<unknown>();
  const { controller, calls } = setup({ mutateTopic: () => waiting.promise });
  await controller.loadTopics();
  let notifications = 0;
  controller.subscribe(() => {
    notifications++;
  });
  const operation = controller.setTopic("trending", "subscribe");
  assert.equal(notifications, 1);
  controller.dispose();
  waiting.resolve(undefined);
  assert.deepEqual(await operation, {
    status: "ignored",
    reason: "superseded",
  });
  assert.equal(notifications, 1);
  assert.deepEqual(
    calls.map((call) => call.operation),
    ["readTopics"],
  );
  assert.deepEqual(await controller.loadTopics(), {
    status: "ignored",
    reason: "disposed",
  });
});

test("external-store snapshots are stable until changes, immutable, and unsubscribe is effective", async () => {
  const input = seed();
  const { controller } = setup({ readSettings: async () => input.settings });
  assert.equal(controller.getSnapshot(), controller.getSnapshot());
  let count = 0;
  const stop = controller.subscribe(() => {
    count++;
  });
  await controller.loadSettings();
  assert.equal(count, 2);
  input.settings.chat.unknownChat.array[0] = 99;
  assert.deepEqual(controller.getSnapshot().settings.data?.chat.unknownChat, {
    array: [1, false, null],
  });
  assert.equal(Object.isFrozen(controller.getSnapshot()), true);
  assert.equal(
    Object.isFrozen(controller.getSnapshot().settings.data?.chat.unknownChat),
    true,
  );
  stop();
  controller.reset();
  assert.equal(count, 2);
});

test("non-JSON and cyclic data are rejected instead of silently dropping unknown fields", () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  for (const extra of [
    undefined,
    () => {},
    NaN,
    Infinity,
    new Date(),
    cycle,
    1n,
  ]) {
    assert.throws(
      () => readPreferenceSnapshot({ chat: {}, social: {}, coins: {}, extra }),
      TypeError,
    );
  }
});

test("reset from a pending-state observer cancels before the adapter is called", async () => {
  const { controller, calls } = setup();
  let once = false;
  controller.subscribe(() => {
    if (!once && controller.getSnapshot().settings.status === "loading") {
      once = true;
      controller.reset();
    }
  });
  assert.deepEqual(await controller.loadSettings(), {
    status: "ignored",
    reason: "superseded",
  });
  assert.deepEqual(calls, []);
});

test("topic invalidation reserves its re-read before notifying observers", async () => {
  const waiting = deferred<unknown>();
  let reads = 0;
  const { controller } = setup({
    readTopics: async () => (++reads === 1 ? seed().topics : waiting.promise),
  });
  await controller.loadTopics();
  const attempts: Array<Promise<unknown>> = [];
  controller.subscribe(() => {
    if (controller.getSnapshot().topics.stale)
      attempts.push(controller.loadTopics());
  });
  const operation = controller.setTopic("trending", "subscribe");
  await Promise.resolve();
  assert.equal(reads, 2);
  assert.equal(controller.getSnapshot().topics.status, "loading");
  assert.deepEqual(await Promise.all(attempts), [
    { status: "ignored", reason: "busy" },
  ]);
  waiting.resolve(seed().topics);
  assert.deepEqual(await operation, { status: "completed", refreshed: true });
});

test("topic read/input failures are local errors, not synthetic server contracts", async () => {
  const { controller, calls } = setup({
    readTopics: async () => ({ topicSubscriptions: [] }),
  });
  assert.deepEqual(await controller.loadTopics(), {
    status: "failed",
    error: { kind: "invalid-data" },
  });
  assert.equal(controller.getSnapshot().topics.data, null);
  const working = setup();
  await working.controller.loadTopics();
  assert.deepEqual(
    await working.controller.setTopic("invented" as "trending", "subscribe"),
    { status: "failed", error: { kind: "invalid-input" } },
  );
  assert.deepEqual(
    await working.controller.setTopic("trending", "invented" as "subscribe"),
    { status: "failed", error: { kind: "invalid-input" } },
  );
  assert.deepEqual(
    working.calls.map((call) => call.operation),
    ["readTopics"],
  );
  assert.deepEqual(calls, []);
});

test("read snapshots and patches preserve inert unusual unknown group keys", () => {
  const current = readPreferenceSnapshot(
    JSON.parse(
      '{"chat":{"__proto__":{"safe":true}},"social":{"constructor":"retained"},"coins":{}}',
    ),
  );
  const merged = mergePreferencePatch(current, {
    chat: { allowGroupNotifications: true },
  })!;
  assert.equal(Object.hasOwn(merged.chat, "__proto__"), true);
  assert.deepEqual(merged.chat.__proto__, { safe: true });
  assert.equal(merged.social.constructor, "retained");
  assert.equal(Object.getPrototypeOf(merged.chat), Object.prototype);
  assert.equal(({} as { safe?: boolean }).safe, undefined);
});

test("an old read cannot overwrite a newer owner load and committed mutation", async () => {
  const old = deferred<unknown>();
  const newer = deferred<unknown>();
  let reads = 0;
  const { controller } = setup({
    readSettings: () => (++reads === 1 ? old.promise : newer.promise),
  });
  const oldLoad = controller.loadSettings();
  controller.reset();
  const newLoad = controller.loadSettings();
  newer.resolve(seed().settings);
  await newLoad;
  await controller.updateSettings({
    social: { allowFollowerNotifications: true },
  });
  const latest = controller.getSnapshot();
  old.resolve({
    chat: {},
    social: { allowFollowerNotifications: false },
    coins: {},
  });
  assert.deepEqual(await oldLoad, { status: "ignored", reason: "superseded" });
  assert.equal(controller.getSnapshot(), latest);
  assert.equal(
    controller.getSnapshot().settings.data?.social.allowFollowerNotifications,
    true,
  );
});

test("old post-invalidation read failure cannot overwrite a newer topic snapshot", async () => {
  const oldRefresh = deferred<unknown>();
  let reads = 0;
  const { controller } = setup({
    readTopics: async () =>
      ++reads === 2 ? oldRefresh.promise : seed().topics,
  });
  await controller.loadTopics();
  const oldWrite = controller.setTopic("trending", "subscribe");
  await Promise.resolve();
  controller.reset();
  await controller.loadTopics();
  const latest = controller.getSnapshot();
  oldRefresh.reject(new Error("old owner refresh failed"));
  assert.deepEqual(await oldWrite, { status: "ignored", reason: "superseded" });
  assert.equal(controller.getSnapshot(), latest);
  assert.equal(controller.getSnapshot().topics.stale, false);
});

test("controlled values disable unavailable/stale states and independently pending categories", async () => {
  const writing = deferred<unknown>();
  let reads = 0;
  const { controller } = setup({
    writeSettings: () => writing.promise,
    readTopics: async () => {
      if (++reads === 2) throw new Error("refresh failed");
      return seed().topics;
    },
  });
  assert.deepEqual(
    preferenceControl(
      controller.getSnapshot(),
      "chat",
      "allowGroupNotifications",
    ),
    { available: false, disabled: true },
  );
  await Promise.all([controller.loadSettings(), controller.loadTopics()]);
  const update = controller.updateSettings({});
  assert.deepEqual(
    preferenceControl(
      controller.getSnapshot(),
      "chat",
      "allowGroupNotifications",
    ),
    { available: true, value: false, disabled: true },
  );
  assert.deepEqual(topicControl(controller.getSnapshot(), "trending"), {
    available: true,
    value: false,
    disabled: false,
  });
  await controller.setTopic("trending", "subscribe");
  assert.deepEqual(topicControl(controller.getSnapshot(), "trending"), {
    available: false,
    disabled: true,
  });
  writing.resolve(undefined);
  await update;
  assert.deepEqual(
    preferenceControl(
      controller.getSnapshot(),
      "chat",
      "allowGroupNotifications",
    ),
    { available: true, value: false, disabled: false },
  );
});

test("only the exact explicit synthetic-test discriminant activates an adapter", async () => {
  for (const kind of ["remote", "synthetic", "", undefined, null]) {
    const local = createSyntheticNotificationAdapter(seed());
    const adapter = {
      ...local.adapter,
      kind,
    } as unknown as NotificationAdapter;
    const controller = createNotificationController(adapter);
    assert.equal(controller.getSnapshot().adapterKind, "unavailable");
    for (const result of await Promise.all([
      controller.loadSettings(),
      controller.loadTopics(),
      controller.updateSettings({}),
      controller.setTopic("trending", "subscribe"),
    ])) {
      assert.deepEqual(result, { status: "ignored", reason: "unavailable" });
    }
    assert.deepEqual(local.calls, []);
    (adapter as { kind: string }).kind = "synthetic-test";
    controller.reset();
    assert.deepEqual(await controller.loadSettings(), {
      status: "ignored",
      reason: "unavailable",
    });
    assert.equal(controller.getSnapshot().adapterKind, "unavailable");
    assert.deepEqual(local.calls, []);
  }
});

test("retry actions keep submitted preference A after pending B is ignored", async () => {
  const pending = deferred<unknown>();
  const submissions: unknown[] = [];
  const { controller } = setup({
    writeSettings: async (value) => {
      submissions.push(value);
      if (submissions.length === 1) return pending.promise;
    },
  });
  const actions = createNotificationActions(controller);
  await controller.loadSettings();
  const patch = { chat: { allowGroupNotifications: true } };
  const first = actions.updateSettings(patch);
  patch.chat.allowGroupNotifications = false;
  assert.deepEqual(
    await actions.updateSettings({
      social: { allowFollowerNotifications: true },
    }),
    { status: "ignored", reason: "busy" },
  );
  pending.reject(new Error("A failed"));
  await first;
  assert.equal(actions.hasSettingsRetry(), true);
  assert.deepEqual(await actions.retrySettings(), { status: "completed" });
  assert.equal(submissions.length, 2);
  assert.deepEqual(submissions[1], submissions[0]);
  assert.equal(
    controller.getSnapshot().settings.data?.chat.allowGroupNotifications,
    true,
  );
  assert.equal(
    controller.getSnapshot().settings.data?.social.allowFollowerNotifications,
    false,
  );
  actions.clear();
  assert.equal(actions.hasSettingsRetry(), false);
  assert.equal(actions.retrySettings(), undefined);
});

test("retry actions keep submitted topic A after pending B is ignored", async () => {
  const pending = deferred<unknown>();
  const submissions: unknown[] = [];
  const { controller } = setup({
    mutateTopic: async (action, body) => {
      submissions.push({ action, body });
      if (submissions.length === 1) return pending.promise;
    },
  });
  const actions = createNotificationActions(controller);
  await controller.loadTopics();
  const first = actions.setTopic({ topic: "trending", action: "subscribe" });
  assert.deepEqual(
    await actions.setTopic({
      topic: "trending_searches",
      action: "unsubscribe",
    }),
    { status: "ignored", reason: "busy" },
  );
  pending.reject(new Error("A failed"));
  await first;
  assert.equal(actions.hasTopicRetry(), true);
  assert.deepEqual(await actions.retryTopic(), {
    status: "completed",
    refreshed: true,
  });
  assert.deepEqual(submissions, [
    { action: "subscribe", body: { topic: "trending" } },
    { action: "subscribe", body: { topic: "trending" } },
  ]);
  actions.clear();
  assert.equal(actions.hasTopicRetry(), false);
  assert.equal(actions.retryTopic(), undefined);
});

test("a listener removed during publication is not invoked from the snapshot", () => {
  const controller = createNotificationController();
  let removedCalls = 0;
  let stopRemoved = () => {};
  controller.subscribe(() => {
    stopRemoved();
  });
  stopRemoved = controller.subscribe(() => {
    removedCalls++;
  });
  controller.reset();
  assert.equal(removedCalls, 0);
});

test("a listener added during publication waits for the next publication", () => {
  const controller = createNotificationController();
  let lateCalls = 0;
  let added = false;
  controller.subscribe(() => {
    if (!added) {
      added = true;
      controller.subscribe(() => {
        lateCalls++;
      });
    }
  });
  controller.reset();
  assert.equal(lateCalls, 0);
  controller.reset();
  assert.equal(lateCalls, 1);
});
