import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acceptClickwrap,
  CAPTURED_TERMS_REVISION,
  CLICKWRAP_COOKIE_VALUE,
  CLICKWRAP_DATE_KEY,
  CLICKWRAP_LEGACY_KEY,
  clickwrapAcceptedAt,
  isClickwrapOutOfScope,
  migrateClickwrapLegacy,
  readClickwrapAccepted,
  type ClickwrapEnvironment,
} from "../packages/frontend/src/components/shell/clickwrap.ts";
function browser(cookie = "", values: Record<string, string> = {}) {
  const items = new Map(Object.entries(values)),
    operations: string[] = [];
  const environment: ClickwrapEnvironment = {
    getCookie: () => cookie,
    setCookie: (value) => {
      operations.push(`cookie:${value}`);
      cookie = value.split(";")[0];
    },
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      operations.push(`storage:${key}=${value}`);
      items.set(key, value);
    },
    now: () => new Date("2026-10-28T12:00:00.000Z"),
    notifyAccepted: () => {
      operations.push("notify");
    },
  };
  return { environment, items, operations };
}
test("a first visit has no inferred consent or writes", () => {
  const b = browser();
  assert.equal(readClickwrapAccepted(b.environment), false);
  migrateClickwrapLegacy(b.environment);
  assert.deepEqual(b.operations, []);
});
test("only the exact captured cookie value marks accepted", () => {
  for (const cookie of [
    "clickwrap_accepted=true",
    "x=1; clickwrap_accepted=true; y=2",
  ])
    assert.equal(readClickwrapAccepted(browser(cookie).environment), true);
  for (const cookie of [
    "clickwrap_accepted=false",
    "clickwrap_accepted=True",
    "other_clickwrap_accepted=true",
    "clickwrap_accepted=trueish",
  ])
    assert.equal(readClickwrapAccepted(browser(cookie).environment), false);
});
test("cookie acceptance short-circuits unavailable legacy storage", () => {
  const b = browser("clickwrap_accepted=true");
  b.environment.getItem = () => {
    throw Error("must not read");
  };
  assert.equal(readClickwrapAccepted(b.environment), true);
});
for (const value of ["true", "false", "", "null"])
  test(`original legacy quirk: non-null ${JSON.stringify(value)} is accepted`, () => {
    assert.equal(
      readClickwrapAccepted(
        browser("", { [CLICKWRAP_LEGACY_KEY]: value }).environment,
      ),
      true,
    );
  });
test("an acceptance date alone does not invent the acceptance flag", () => {
  assert.equal(
    readClickwrapAccepted(
      browser("", { [CLICKWRAP_DATE_KEY]: "2026-10-28" }).environment,
    ),
    false,
  );
});
test("unavailable legacy storage does not invent acceptance", () => {
  const b = browser();
  b.environment.getItem = () => {
    throw Error("blocked");
  };
  assert.equal(readClickwrapAccepted(b.environment), false);
  migrateClickwrapLegacy(b.environment);
  assert.deepEqual(b.operations, []);
});
test("legacy migration writes only the recorded cookie, preserving the date", () => {
  const b = browser("", {
    [CLICKWRAP_LEGACY_KEY]: "false",
    [CLICKWRAP_DATE_KEY]: "old value",
  });
  migrateClickwrapLegacy(b.environment);
  assert.deepEqual(b.operations, [`cookie:${CLICKWRAP_COOKIE_VALUE}`]);
  assert.equal(b.items.get(CLICKWRAP_DATE_KEY), "old value");
});
test("blocked legacy migration cookie does not escape the browser boundary", () => {
  const b = browser("", { [CLICKWRAP_LEGACY_KEY]: "true" });
  b.environment.setCookie = () => {
    throw Error("cookie blocked");
  };
  assert.doesNotThrow(() => migrateClickwrapLegacy(b.environment));
  assert.deepEqual(b.operations, []);
});
test("already accepted cookies do not cause migration writes", () => {
  const b = browser("clickwrap_accepted=true", {
    [CLICKWRAP_LEGACY_KEY]: "true",
  });
  migrateClickwrapLegacy(b.environment);
  assert.deepEqual(b.operations, []);
});
test("acceptance preserves cookie, legacy, date, notification ordering", () => {
  const b = browser();
  acceptClickwrap(b.environment);
  assert.deepEqual(b.operations, [
    `cookie:${CLICKWRAP_COOKIE_VALUE}`,
    `storage:${CLICKWRAP_LEGACY_KEY}=true`,
    `storage:${CLICKWRAP_DATE_KEY}=2026-10-28T12:00:00.000Z`,
    "notify",
  ]);
  assert.equal(readClickwrapAccepted(b.environment), true);
});
test("storage failure still notifies and does not attempt the later date write", () => {
  const b = browser();
  b.environment.setItem = (key) => {
    b.operations.push(`blocked:${key}`);
    throw Error("blocked");
  };
  acceptClickwrap(b.environment);
  assert.deepEqual(b.operations, [
    `cookie:${CLICKWRAP_COOKIE_VALUE}`,
    `blocked:${CLICKWRAP_LEGACY_KEY}`,
    "notify",
  ]);
});
test("second storage failure preserves the first write and still notifies", () => {
  const b = browser(),
    set = b.environment.setItem;
  b.environment.setItem = (key, value) => {
    if (key === CLICKWRAP_DATE_KEY) throw Error("date blocked");
    set(key, value);
  };
  acceptClickwrap(b.environment);
  assert.equal(b.items.get(CLICKWRAP_LEGACY_KEY), "true");
  assert.equal(b.operations.at(-1), "notify");
});
test("cookie write failure falls back to legacy storage and notification", () => {
  const b = browser();
  b.environment.setCookie = () => {
    b.operations.push("blocked:cookie");
    throw Error("cookie blocked");
  };
  acceptClickwrap(b.environment);
  assert.deepEqual(b.operations, [
    "blocked:cookie",
    `storage:${CLICKWRAP_LEGACY_KEY}=true`,
    `storage:${CLICKWRAP_DATE_KEY}=2026-10-28T12:00:00.000Z`,
    "notify",
  ]);
  assert.equal(b.items.get(CLICKWRAP_LEGACY_KEY), "true");
});
test("date helper uses the archived revision floor, not a newly invented policy", () => {
  assert.equal(CAPTURED_TERMS_REVISION, "2026-10-17");
  assert.equal(
    clickwrapAcceptedAt(new Date("2026-10-01")),
    "2026-10-17T00:00:00.000Z",
  );
  assert.equal(
    clickwrapAcceptedAt(new Date("2026-10-28T12:00:00Z")),
    "2026-10-28T12:00:00.000Z",
  );
});
test("captured route exclusions use exact prefix boundaries and original address forms", () => {
  for (const prefix of [
    "/docs",
    "/landing",
    "/u",
    "/join",
    "/livechat",
    "/moderation",
    "/blocked",
    "/r",
    "/voice-chat",
    "/coin-share",
    "/c",
  ]) {
    assert.equal(isClickwrapOutOfScope(prefix), true);
    assert.equal(isClickwrapOutOfScope(prefix + "/nested"), true);
    assert.equal(isClickwrapOutOfScope(prefix + "other"), false);
  }
  for (const path of [
    "/" + "1".repeat(32),
    "/0x" + "a".repeat(40),
    "/" + "1".repeat(44) + "/@name/",
  ])
    assert.equal(isClickwrapOutOfScope(path), true);
  for (const path of [
    "/",
    "/explore",
    "/profile/example",
    "/" + "0".repeat(32),
    "/0x" + "a".repeat(39),
  ])
    assert.equal(isClickwrapOutOfScope(path), false);
});
