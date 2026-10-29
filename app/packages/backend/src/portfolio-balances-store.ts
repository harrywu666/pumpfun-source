/** Independent public aggregate-balance read model; all values are supplied facts. */
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

export const balanceWalletPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const base58Alphabet =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export interface PublicBalanceFacts {
  totalValueUsd: number | null;
  solPriceUsd: number | null;
  nativeBalanceSol: number | null;
}
export interface PortfolioBalancesDataset {
  schemaVersion: 1;
  dataSource: "synthetic" | "local-materialized";
  observedAt: string;
  wallets: Array<{ wallet: string; balance: PublicBalanceFacts | null }>;
}
export interface BalanceBatch {
  wallets: Record<string, (PublicBalanceFacts & { perpCashUsd: null }) | null>;
}
export class BalanceBatchQueryError extends Error {}

function isSolanaWallet(value: string): boolean {
  if (!balanceWalletPattern.test(value)) return false;
  let leadingZeroBytes = 0;
  while (value[leadingZeroBytes] === "1") leadingZeroBytes++;
  let magnitude = 0n;
  for (let index = leadingZeroBytes; index < value.length; index++)
    magnitude = magnitude * 58n + BigInt(base58Alphabet.indexOf(value[index]));
  let magnitudeBytes = 0;
  while (magnitude > 0n) {
    magnitude >>= 8n;
    magnitudeBytes++;
  }
  return leadingZeroBytes + magnitudeBytes === 32;
}
function invalid(message: string): never {
  throw new Error(`Invalid balance materialization: ${message}`);
}
function object(
  value: unknown,
  fields: string[],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).some((key) => !fields.includes(key)) ||
    fields.some((key) => !Object.hasOwn(value, key))
  )
    invalid("unexpected object shape");
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
      (_match, part: string | undefined) => `.${(part ?? "").padEnd(3, "0")}Z`,
    )
  );
}

/** Startup-only snapshot. No prices, EVM links, holdings or financial totals are derived. */
export class PortfolioBalancesStore {
  readonly dataSource: PortfolioBalancesDataset["dataSource"];
  readonly observedAt: string;
  private readonly balances = new Map<string, PublicBalanceFacts | null>();

  constructor(input: unknown) {
    object(input, ["schemaVersion", "dataSource", "observedAt", "wallets"]);
    if (
      input.schemaVersion !== 1 ||
      !["synthetic", "local-materialized"].includes(
        input.dataSource as string,
      ) ||
      !instant(input.observedAt) ||
      !Array.isArray(input.wallets)
    )
      invalid("schemaVersion/dataSource/observedAt/wallets");
    this.dataSource =
      input.dataSource as PortfolioBalancesDataset["dataSource"];
    this.observedAt = input.observedAt;
    for (const entry of input.wallets) {
      object(entry, ["wallet", "balance"]);
      if (
        typeof entry.wallet !== "string" ||
        !isSolanaWallet(entry.wallet) ||
        this.balances.has(entry.wallet)
      )
        invalid("wallet identity");
      if (entry.balance === null) {
        this.balances.set(entry.wallet, null);
        continue;
      }
      object(entry.balance, [
        "totalValueUsd",
        "solPriceUsd",
        "nativeBalanceSol",
      ]);
      for (const field of [
        "totalValueUsd",
        "solPriceUsd",
        "nativeBalanceSol",
      ]) {
        if (
          !Object.hasOwn(entry.balance, field) ||
          !(
            entry.balance[field] === null ||
            (typeof entry.balance[field] === "number" &&
              Number.isFinite(entry.balance[field]) &&
              (entry.balance[field] as number) >= 0)
          )
        )
          invalid(`balance.${field}`);
      }
      this.balances.set(entry.wallet, {
        totalValueUsd: entry.balance.totalValueUsd as number | null,
        solPriceUsd: entry.balance.solPriceUsd as number | null,
        nativeBalanceSol: entry.balance.nativeBalanceSol as number | null,
      });
    }
  }

  batch(wallets: string[]): BalanceBatch {
    if (
      !Array.isArray(wallets) ||
      wallets.length < 1 ||
      wallets.length > 50 ||
      ![...wallets].every(
        (wallet) => typeof wallet === "string" && isSolanaWallet(wallet),
      )
    )
      throw new BalanceBatchQueryError();
    return {
      wallets: Object.fromEntries(
        [...new Set(wallets)].map((wallet) => {
          const value = this.balances.get(wallet);
          // A missing local read is unavailable, never an invented zero balance.
          if (!value) return [wallet, null];
          return [
            wallet,
            {
              totalValueUsd: value.totalValueUsd,
              solPriceUsd: value.solPriceUsd,
              nativeBalanceSol: value.nativeBalanceSol,
              // The public API host never serves owner-only perp cash or holdings.
              perpCashUsd: null,
            },
          ];
        }),
      ),
    };
  }
}

/** Never accepts an HTTP-selected path, remote URL or write request. */
export function loadPortfolioBalancesStore(
  path: string,
): PortfolioBalancesStore {
  const limit = 16 * 1024 * 1024;
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > limit)
      invalid("source must be a regular file of at most16MiB");
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size > limit) invalid("source exceeds16MiB");
    return new PortfolioBalancesStore(
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
