import assert from "node:assert/strict";
import test from "node:test";
import {
  PublicWalletController,
  publicAddress,
} from "../packages/frontend/src/app/auth/public-wallet/controller.ts";

const A = "11111111111111111111111111111111";
const B = "So11111111111111111111111111111111111111112";
function fixture(timeout = 15000) {
  const target = new EventTarget();
  const controller = new PublicWalletController(target, timeout);
  let callback: ((change: unknown) => void) | null = null;
  let reads = 0,
    connects = 0,
    disconnects = 0,
    stops = 0;
  let accounts: unknown = [{ address: A, chains: ["solana:mainnet"] }];
  let connectAccounts: readonly unknown[] | null = null;
  let connect = async () => {};
  let disconnect = async () => {};
  const features = {
    "standard:connect": {
      version: "1.0.0",
      async connect() {
        connects++;
        await connect();
        return { accounts: connectAccounts ?? accounts };
      },
    },
    "standard:events": {
      version: "1.0.0",
      on(event: string, fn: typeof callback) {
        assert.equal(event, "change");
        callback = fn;
        return () => {
          stops++;
          callback = null;
        };
      },
    },
    "standard:disconnect": {
      version: "1.0.0",
      async disconnect() {
        disconnects++;
        await disconnect();
      },
    },
    get "solana:signMessage"(): never {
      throw new Error("must not read signing capability");
    },
    get "solana:signIn"(): never {
      throw new Error("must not read sign-in capability");
    },
    get "solana:signTransaction"(): never {
      throw new Error("must not read transactions");
    },
  };
  const wallet = {
    version: "1.0.0",
    name: "Public Test Wallet",
    chains: ["solana:mainnet"],
    features,
    get accounts() {
      reads++;
      return accounts;
    },
    get icon(): never {
      throw new Error("must not read remote icons");
    },
  };
  let unregister = () => {};
  let api: { register(...wallets: unknown[]): () => void };
  target.addEventListener("wallet-standard:app-ready", (event) => {
    api = (event as CustomEvent).detail;
    unregister = api.register(wallet);
  });
  return {
    target,
    controller,
    wallet,
    features,
    get counts() {
      return { reads, connects, disconnects, stops };
    },
    unregister: () => unregister(),
    register: (...wallets: unknown[]) => api.register(...wallets),
    accounts(value: unknown) {
      accounts = value;
    },
    connectAccounts(value: readonly unknown[]) {
      connectAccounts = value;
    },
    connect(fn: typeof connect) {
      connect = fn;
    },
    disconnect(fn: typeof disconnect) {
      disconnect = fn;
    },
    change(value: unknown) {
      callback?.(value);
    },
  };
}
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};

test("public address validates exactly 32 base58 bytes, with no ownership claim", () => {
  for (const address of [A, B]) assert.equal(publicAddress(address), address);
  for (const address of [
    null,
    "",
    "1".repeat(31),
    "1".repeat(33),
    "0".repeat(32),
    "z".repeat(44),
    ` ${A}`,
  ])
    assert.throws(() => publicAddress(address));
});
test("discovery reads metadata only; connection is explicit, no signing or icons accessed", async () => {
  const f = fixture();
  assert.deepEqual(f.counts, {
    reads: 0,
    connects: 0,
    disconnects: 0,
    stops: 0,
  });
  f.controller.discover();
  assert.equal(f.controller.getSnapshot().wallets.length, 1);
  assert.equal(f.counts.reads, 0);
  await f.controller.connect(0);
  assert.equal(f.controller.getSnapshot().address, A);
  assert.equal(f.counts.connects, 1);
  assert.equal(f.counts.disconnects, 0);
  f.controller.dispose();
});
test("late register events and duplicate names use actual object identity", () => {
  const f = fixture();
  f.controller.discover();
  f.target.dispatchEvent(
    new CustomEvent("wallet-standard:register-wallet", {
      detail: (api: any) => api.register(Object.create(f.wallet)),
    }),
  );
  assert.equal(f.controller.getSnapshot().wallets.length, 2);
  f.register(f.wallet);
  assert.equal(f.controller.getSnapshot().wallets.length, 2);
  f.controller.dispose();
  f.register(Object.create(f.wallet));
  assert.deepEqual(f.controller.getSnapshot().wallets, []);
});
test("unsupported metadata and throwing provider getters do not break registration", () => {
  const f = fixture();
  f.controller.discover();
  for (const bad of [
    null,
    {},
    Object.assign(Object.create(f.wallet), { chains: ["eip155:1"] }),
    Object.assign(Object.create(f.wallet), { name: "bad\nname" }),
    Object.assign(Object.create(f.wallet), { version: "2.0.0" }),
    {
      get version() {
        throw new Error("private");
      },
    },
  ])
    f.register(bad);
  assert.equal(f.controller.getSnapshot().wallets.length, 1);
  f.target.dispatchEvent(
    new CustomEvent("wallet-standard:register-wallet", {
      detail: () => {
        throw new Error("private");
      },
    }),
  );
  f.controller.dispose();
});
test("connection failure hides provider payload and retry can succeed", async () => {
  const f = fixture();
  f.controller.discover();
  f.connect(async () => {
    throw new Error("credential-and-provider-payload");
  });
  await f.controller.connect(0);
  assert.equal(f.controller.getSnapshot().status, "error");
  assert.doesNotMatch(JSON.stringify(f.controller.getSnapshot()), /credential/);
  f.connect(async () => {});
  await f.controller.connect(0);
  assert.equal(f.controller.getSnapshot().address, A);
  f.controller.dispose();
});
test("uses accounts returned by standard connect before wallet metadata catches up", async () => {
  const f = fixture();
  f.accounts([]);
  f.connectAccounts([{ address: A, chains: ["solana:mainnet"] }]);
  f.controller.discover();
  await f.controller.connect(0);
  assert.equal(f.controller.getSnapshot().status, "connected");
  assert.equal(f.controller.getSnapshot().address, A);
  assert.equal(f.counts.reads, 0);
  f.controller.dispose();
});
test("cancel, unregister and dispose reject late connection responses", async () => {
  for (const action of ["cancel", "unregister", "dispose"]) {
    const f = fixture(),
      pending = deferred();
    f.controller.discover();
    f.connect(() => pending.promise);
    const result = f.controller.connect(0);
    if (action === "cancel") f.controller.forget();
    else if (action === "unregister") f.unregister();
    else f.controller.dispose();
    pending.resolve();
    await result;
    assert.equal(f.controller.getSnapshot().address, null);
    assert.equal(f.counts.reads, 0);
    f.controller.dispose();
  }
});
test("duplicate connect attempts do not open duplicate prompts", async () => {
  const f = fixture(),
    pending = deferred();
  f.controller.discover();
  f.connect(() => pending.promise);
  const first = f.controller.connect(0);
  await f.controller.connect(0);
  assert.equal(f.counts.connects, 1);
  pending.resolve();
  await first;
  f.controller.dispose();
});
test("timeout invalidates late wallet approval", async () => {
  const f = fixture(5),
    pending = deferred();
  f.controller.discover();
  f.connect(() => pending.promise);
  const first = f.controller.connect(0);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(f.controller.getSnapshot().status, "error");
  pending.resolve();
  await first;
  assert.equal(f.controller.getSnapshot().address, null);
  f.controller.dispose();
});
test("first account changes update the public address; empty/revoked/malformed accounts clear it", async () => {
  for (const bad of [
    [],
    [{ address: "not a key", chains: ["solana:mainnet"] }],
    [{ address: B, chains: ["eip155:1"] }],
  ]) {
    const f = fixture();
    f.controller.discover();
    await f.controller.connect(0);
    f.change({
      accounts: [{ address: B, chains: ["solana:devnet"] }],
    });
    assert.equal(f.controller.getSnapshot().address, B);
    f.change({ accounts: bad });
    assert.equal(f.controller.getSnapshot().address, null);
    assert.equal(f.counts.stops, 1);
    f.controller.dispose();
  }
});
test("disconnect forgets before provider completion, failures do not restore address", async () => {
  const f = fixture(),
    pending = deferred();
  f.controller.discover();
  await f.controller.connect(0);
  f.disconnect(() => pending.promise);
  const done = f.controller.disconnect();
  assert.equal(f.controller.getSnapshot().address, null);
  assert.equal(f.controller.getSnapshot().status, "disconnecting");
  await f.controller.connect(0);
  assert.equal(f.counts.connects, 1);
  pending.resolve();
  await done;
  f.disconnect(async () => {
    throw new Error("sensitive-disconnect-error");
  });
  await f.controller.connect(0);
  await f.controller.disconnect();
  assert.equal(f.controller.getSnapshot().address, null);
  assert.doesNotMatch(JSON.stringify(f.controller.getSnapshot()), /sensitive/);
  f.controller.dispose();
});
test("malformed first account or event subscription fails closed", async () => {
  const f = fixture();
  f.controller.discover();
  f.accounts([]);
  await f.controller.connect(0);
  assert.equal(f.controller.getSnapshot().address, null);
  f.accounts([{ address: A, chains: ["solana:mainnet"] }]);
  f.features["standard:events"].on = () => null as any;
  await f.controller.connect(0);
  assert.equal(f.controller.getSnapshot().address, null);
  f.controller.dispose();
});

test("optional disconnect absence explicitly distinguishes local forgetting from wallet authorization", async () => {
  const f = fixture();
  Reflect.deleteProperty(f.features, "standard:disconnect");
  f.controller.discover();
  await f.controller.connect(0);
  assert.equal(f.controller.getSnapshot().address, A);
  await f.controller.disconnect();
  assert.equal(f.controller.getSnapshot().address, null);
  assert.equal(f.controller.getSnapshot().status, "choosing");
  assert.match(
    f.controller.getSnapshot().message!,
    /wallet connection may remain active/,
  );
  assert.equal(f.counts.disconnects, 0);
  f.controller.dispose();
});

test('selects a Solana account after another chain account and tracks changes', async () => {
  const f = fixture();
  f.accounts([{ address: '0xsynthetic', chains: ['eip155:1'] }, { address: A, chains: ['solana:mainnet'] }]);
  f.controller.discover();
  try {
    await f.controller.connect(0);
    assert.equal(f.controller.getSnapshot().status, 'connected');
    assert.equal(f.controller.getSnapshot().address, A);
    f.change({ accounts: [{ address: '0xsynthetic', chains: ['eip155:1'] }, { address: B, chains: ['solana:mainnet'] }] });
    assert.equal(f.controller.getSnapshot().address, B);
    f.change({ accounts: [{ address: '0xsynthetic', chains: ['eip155:1'] }] });
    assert.equal(f.controller.getSnapshot().address, null);
  } finally { f.controller.dispose(); }
});

test('concurrent disconnect requests call the provider once', async () => {
  const f=fixture();const releases:Array<()=>void>=[];let pending:Promise<void>[]=[];
  f.disconnect(()=>new Promise<void>(resolve=>releases.push(resolve)));
  f.controller.discover();await f.controller.connect(0);
  try {
    pending=[f.controller.disconnect(),f.controller.disconnect()];
    assert.equal(f.counts.disconnects,1);
    assert.equal(f.controller.getSnapshot().status,"disconnecting");
    await f.controller.connect(0);
    assert.equal(f.counts.connects,1);
    assert.equal(f.controller.getSnapshot().address,null);
  } finally {releases.forEach(resolve=>resolve());await Promise.all(pending);f.controller.dispose();}
});
