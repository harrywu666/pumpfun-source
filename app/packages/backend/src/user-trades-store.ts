/** Independent, read-only spot trade history over an explicit local materialization. */
import { createHash } from "node:crypto";
import {
  closeSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  constants,
} from "node:fs";
import type { operations } from "./generated/developer-api.js";
import { assertSchema, type SchemaNode } from "./schema-validator.js";

type Response =
  operations["get_user_trades_by_id"]["responses"][200]["content"]["application/json"];
export type UserTrade = Response["trades"][number];
export type TradeCoin = Response["coins"][number];
export type TradeProfile = Response["traders"][number];
export type TradeFacts = Omit<
  UserTrade,
  "kind" | "collectible" | "collectibleLeg"
>;
export interface UserTradesDataset {
  schemaVersion: 1;
  dataSource: "synthetic" | "local-materialized";
  observedAt: string;
  users: Array<{ id: string; aliases: string[] }>;
  /** Explicit canonical-wallet relation; no discovery or identity inference. */
  wallets: Array<{ address: string; chainId: number; userId: string | null }>;
  rows: Array<{ kind: "trade" | "transfer"; facts: TradeFacts }>;
  coins: TradeCoin[];
  traders: TradeProfile[];
}
export interface UserTradesOptions {
  mint?: string;
  chainId?: number;
  limit?: number;
  cursor?: string;
  types?: Array<"trades" | "transfers">;
}
export class TradesQueryError extends Error {}

const spec = JSON.parse(
  readFileSync(
    new URL("../../../contracts/developer.openapi.json", import.meta.url),
    "utf8",
  ),
);
const responseSchema: SchemaNode =
  spec.paths["/user-trades/{id}"].get.responses["200"].content[
    "application/json"
  ].schema;
const sha = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clone = <T>(value: T): T => structuredClone(value);
const compare = (a: string, b: string) => (a === b ? 0 : a < b ? -1 : 1);
const walletKey = (address: string, chainId: number) =>
  JSON.stringify([address, chainId]);
const rowKey = (row: TradeFacts) =>
  JSON.stringify([row.chainId, row.slotIndexId]);
const coinKey = (mint: string, chainId: number | null) =>
  JSON.stringify([mint, chainId]);
const text = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  !/[\x00-\x1f\x7f]/.test(value);

function invalid(reason: string): never {
  throw new Error(`Invalid user-trades materialization: ${reason}`);
}
function object(
  value: unknown,
  fields: string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    invalid(label);
}
function plain(value: unknown, depth = 0): void {
  if (depth > 40) invalid("input is too deeply nested");
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return;
  if (Array.isArray(value)) {
    for (const item of value) plain(item, depth + 1);
    return;
  }
  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key))
        invalid("prototype-related field");
      plain(item, depth + 1);
    }
    return;
  }
  invalid("expected finite plain JSON");
}
function instant(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return false;
  return (
    new Date(value).toISOString() ===
    value.replace(
      /(?:\.(\d{1,3}))?Z$/,
      (_match, fraction: string | undefined) =>
        `.${(fraction ?? "").padEnd(3, "0")}Z`,
    )
  );
}

/** Facts, prices and canonical wallets are supplied; this class never calculates PnL. */
export class UserTradesStore {
  readonly dataSource: UserTradesDataset["dataSource"];
  readonly observedAt: string;
  private readonly snapshot: string;
  private readonly users = new Map<string, string>();
  private readonly wallets = new Map<
    string,
    UserTradesDataset["wallets"][number]
  >();
  private readonly addresses = new Set<string>();
  private readonly rows: UserTradesDataset["rows"];
  private readonly coins = new Map<string, TradeCoin>();
  private readonly traders = new Map<string, TradeProfile>();

  constructor(input: unknown) {
    plain(input);
    object(
      input,
      [
        "schemaVersion",
        "dataSource",
        "observedAt",
        "users",
        "wallets",
        "rows",
        "coins",
        "traders",
      ],
      "dataset",
    );
    if (
      input.schemaVersion !== 1 ||
      !["synthetic", "local-materialized"].includes(
        input.dataSource as string,
      ) ||
      !instant(input.observedAt)
    )
      invalid("schemaVersion/dataSource/observedAt");
    for (const field of ["users", "wallets", "rows", "coins", "traders"])
      if (!Array.isArray(input[field])) invalid(field);
    const data = clone(input) as unknown as UserTradesDataset;
    this.dataSource = data.dataSource;
    this.observedAt = data.observedAt;
    this.snapshot = sha(data);
    const canonicalUsers = new Set<string>();
    for (const user of data.users) {
      object(user, ["id", "aliases"], "user");
      if (
        !text(user.id) ||
        !Array.isArray(user.aliases) ||
        !user.aliases.every(text)
      )
        invalid("user identity");
      canonicalUsers.add(user.id);
      for (const id of [user.id, ...user.aliases]) {
        if (this.users.has(id)) invalid("ambiguous user/alias");
        this.users.set(id, user.id);
      }
    }
    const addressOwner = new Map<string, string | null>();
    for (const wallet of data.wallets) {
      object(wallet, ["address", "chainId", "userId"], "wallet");
      if (
        !text(wallet.address) ||
        !Number.isSafeInteger(wallet.chainId) ||
        wallet.chainId <= 0 ||
        (wallet.userId !== null && !canonicalUsers.has(wallet.userId))
      )
        invalid("wallet identity/chain/user");
      if (
        this.users.has(wallet.address) ||
        this.wallets.has(walletKey(wallet.address, wallet.chainId))
      )
        invalid("ambiguous wallet identity");
      if (
        addressOwner.has(wallet.address) &&
        addressOwner.get(wallet.address) !== wallet.userId
      )
        invalid("cross-chain wallet owner conflict");
      addressOwner.set(wallet.address, wallet.userId);
      this.addresses.add(wallet.address);
      this.wallets.set(walletKey(wallet.address, wallet.chainId), wallet);
    }
    for (const profile of data.traders) {
      assertSchema(
        profile,
        responseSchema.properties!.traders.items!,
        "trader",
        spec,
      );
      if (
        !canonicalUsers.has(profile.userId) ||
        this.traders.has(profile.userId)
      )
        invalid("trader identity");
      if (
        profile.walletAddress !== null &&
        addressOwner.get(profile.walletAddress) !== profile.userId
      )
        invalid("trader wallet belongs to another user");
      this.traders.set(profile.userId, profile);
    }
    for (const coin of data.coins) {
      assertSchema(coin, responseSchema.properties!.coins.items!, "coin", spec);
      if (
        !text(coin.mint) ||
        !Number.isSafeInteger(coin.chainId) ||
        (coin.chainId ?? 0) <= 0 ||
        this.coins.has(coinKey(coin.mint, coin.chainId))
      )
        invalid("coin identity");
      this.coins.set(coinKey(coin.mint, coin.chainId), coin);
    }
    const identities = new Set<string>();
    for (const record of data.rows) {
      object(record, ["kind", "facts"], "row");
      if (!["trade", "transfer"].includes(record.kind)) invalid("row kind");
      const row = record.facts;
      if (
        !row ||
        typeof row !== "object" ||
        ["kind", "collectible", "collectibleLeg", "chain"].some((field) =>
          Object.hasOwn(row, field),
        )
      )
        invalid(
          "only spot facts without embedded kind/enrichment are supported",
        );
      assertSchema(
        row,
        responseSchema.properties!.trades.items!,
        "trade",
        spec,
      );
      if (
        !text(row.tx) ||
        !text(row.mint) ||
        !text(row.walletAddress) ||
        !/^\d{26}$/.test(row.slotIndexId) ||
        (row.timestamp !== null && !instant(row.timestamp))
      )
        invalid("trade identity/timestamp");
      if (row.timestamp !== null && Date.parse(row.timestamp) > Date.parse(this.observedAt)) invalid("trade timestamp exceeds observedAt");
      if (!Number.isSafeInteger(row.chainId) || (row.chainId ?? 0) <= 0)
        invalid("unsupported trade chain");
      const wallet = this.wallets.get(
        walletKey(row.walletAddress, row.chainId!),
      );
      if (!wallet || wallet.userId !== row.userId)
        invalid("trade wallet/user relation");
      if (row.userId !== null && !this.traders.has(row.userId))
        invalid("trade references a missing public trader");
      if (identities.has(rowKey(row))) invalid("duplicate chain/slotIndexId");
      identities.add(rowKey(row));
    }
    this.rows = data.rows.sort((a, b) => {
      const at =
        a.facts.timestamp === null ? null : Date.parse(a.facts.timestamp);
      const bt =
        b.facts.timestamp === null ? null : Date.parse(b.facts.timestamp);
      const time =
        at === null ? (bt === null ? 0 : 1) : bt === null ? -1 : bt - at;
      return (
        time ||
        -compare(a.facts.slotIndexId, b.facts.slotIndexId) ||
        a.facts.chainId! - b.facts.chainId!
      );
    });
  }

  page(id: string, options: UserTradesOptions = {}): Response | null {
    const limit = options.limit ?? 50;
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 200 ||
      (options.chainId !== undefined &&
        !Number.isSafeInteger(options.chainId)) ||
      (options.mint !== undefined && typeof options.mint !== "string") ||
      (options.types !== undefined &&
        (!Array.isArray(options.types) ||
          options.types.length > 2 ||
          ![...options.types].every(
            (type) => type === "trades" || type === "transfers",
          )))
    )
      throw new TradesQueryError();
    const user = this.users.get(id);
    if (!user && !this.addresses.has(id)) return null;
    const explicitTypes = options.types !== undefined;
    const types = [...new Set(options.types ?? ["trades"])].sort();
    const selection = sha([
      user ? ["user", user] : ["wallet", id],
      options.mint ?? null,
      options.chainId ?? null,
      types,
      explicitTypes,
    ]);
    const rows = this.rows.filter(
      ({ facts, kind }) =>
        (user ? facts.userId === user : facts.walletAddress === id) &&
        (options.mint === undefined || facts.mint === options.mint) &&
        (options.chainId === undefined || facts.chainId === options.chainId) &&
        types.includes(kind === "trade" ? "trades" : "transfers"),
    );
    let start = 0;
    if (options.cursor !== undefined) {
      try {
        const cursor = options.cursor;
        if (
          typeof cursor !== "string" ||
          cursor.length > 2048 ||
          !/^[A-Za-z0-9_-]+$/.test(cursor)
        )
          throw new Error();
        const decoded = Buffer.from(cursor, "base64url");
        if (decoded.toString("base64url") !== cursor) throw new Error();
        const value = JSON.parse(
          new TextDecoder("utf-8", {
            fatal: true,
            // Do not strip a BOM: JSON.parse would otherwise accept it.
            ignoreBOM: true,
          }).decode(decoded),
        );
        object(value, ["v", "snapshot", "selection", "after"], "cursor");
        if (
          value.v !== 1 ||
          value.snapshot !== this.snapshot ||
          value.selection !== selection ||
          typeof value.after !== "string"
        )
          throw new Error();
        const found = rows.findIndex(
          (row) => rowKey(row.facts) === value.after,
        );
        if (found < 0) throw new Error();
        start = found + 1;
      } catch {
        throw new TradesQueryError();
      }
    }
    const selected = rows.slice(start, start + limit);
    const last = selected.at(-1);
    const nextCursor =
      last && start + selected.length < rows.length
        ? Buffer.from(
            JSON.stringify({
              v: 1,
              snapshot: this.snapshot,
              selection,
              after: rowKey(last.facts),
            }),
          ).toString("base64url")
        : null;
    const profileIds = [
      ...new Set(
        selected.flatMap((row) =>
          row.facts.userId === null ? [] : [row.facts.userId],
        ),
      ),
    ];
    const coinIds = [
      ...new Set(
        selected.map((row) => coinKey(row.facts.mint, row.facts.chainId)),
      ),
    ];
    return {
      trades: selected.map((row) =>
        explicitTypes
          ? { ...clone(row.facts), kind: row.kind }
          : clone(row.facts),
      ),
      traders: profileIds.flatMap((key) =>
        this.traders.has(key) ? [clone(this.traders.get(key)!)] : [],
      ),
      coins: coinIds.flatMap((key) => {
        const supplied = this.coins.get(key);
        // The captured contract omits lookup misses; a null-filled card is not a miss.
        return supplied ? [clone(supplied)] : [];
      }),
      nextCursor,
    };
  }
}

/** Explicit server-owned startup import; never accepts a request-supplied path or URL. */
export function loadUserTradesStore(path: string): UserTradesStore {
  const limit = 16 * 1024 * 1024;
  // Reach fstat for a FIFO instead of waiting indefinitely for a writer.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit)
      invalid("TRADES_FILE must be a regular file of at most16MiB");
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size > limit) invalid("TRADES_FILE exceeds16MiB");
    return new UserTradesStore(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          buffer.subarray(0, size),
        ),
      ),
    );
  } finally {
    closeSync(fd);
  }
}
