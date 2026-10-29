"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PortfolioSuccess } from "../portfolio/types";
import { PublicBalanceError, readPdaBalances } from "./read-balances";

type State =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; value: PortfolioSuccess };
const buttonClass =
  "min-h-11 rounded-lg border border-border-tertiary px-4 py-2 text-sm font-semibold text-text-primary hover:bg-bg-tertiary aria-disabled:opacity-50";

/** Mounted with the derived PDA as its key: edits/reset dispose all old observations. */
export function HolderRewardsPublicBalances({ address }: { address: string }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const pending = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      generation.current++;
      pending.current?.abort();
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  async function load() {
    const sequence = ++generation.current;
    pending.current?.abort();
    if (timer.current !== null) clearTimeout(timer.current);
    const controller = new AbortController();
    pending.current = controller;
    setState({ status: "loading" });
    const deadline = setTimeout(() => {
      if (sequence !== generation.current) return;
      controller.abort();
      generation.current++;
      setState({
        status: "error",
        message: "The public balance request timed out. Try again.",
      });
    }, 20_000);
    timer.current = deadline;
    try {
      const value = await readPdaBalances(address, {
        signal: controller.signal,
      });
      if (sequence === generation.current && !controller.signal.aborted)
        setState({ status: "ready", value });
    } catch (error) {
      if (sequence === generation.current && !controller.signal.aborted)
        setState({
          status: "error",
          message:
            error instanceof PublicBalanceError
              ? error.message
              : "Public balances are unavailable. Try again later.",
        });
    } finally {
      clearTimeout(deadline);
      if (timer.current === deadline) timer.current = null;
      if (pending.current === controller) pending.current = null;
    }
  }
  const value = state.status === "ready" ? state.value : null;
  return (
    <section
      className="rounded-2xl border border-border-secondary bg-bg-secondary p-5 sm:p-7"
      aria-labelledby="holder-public-balance-heading"
      data-testid="holder-public-balances"
    >
      <h2
        id="holder-public-balance-heading"
        className="text-xl font-semibold text-text-primary"
      >
        Public balances at the derived address
      </h2>
      <p className="mt-2 text-sm leading-6 text-text-tertiary">
        Optionally query public Solana mainnet data for this PDA. These are
        account holdings, not accrued, claimed or claimable rewards. Zero
        balances do not establish whether an account exists or whether a coin
        participates in Holder Rewards.
      </p>
      <button
        type="button"
        className={`${buttonClass} mt-4`}
        aria-disabled={state.status === "loading"}
        onClick={() => {
          if (state.status !== "loading") void load();
        }}
      >
        {state.status === "loading"
          ? "Loading public balances…"
          : value
            ? "Refresh public PDA balances"
            : "Read public PDA balances"}
      </button>
      {state.status === "loading" && (
        <p className="mt-3 text-sm text-text-tertiary" role="status">
          Reading public account data. No wallet or signature is requested.
        </p>
      )}
      {state.status === "error" && (
        <p className="mt-3 text-sm text-text-error" role="alert">
          {state.message}
        </p>
      )}
      {value && (
        <div
          className="mt-5 grid min-w-0 gap-4"
          data-testid="holder-public-balances-result"
        >
          <dl className="grid gap-2 text-sm">
            <div>
              <dt className="text-text-tertiary">
                Total account SOL balance, including any rent or reserve
              </dt>
              <dd className="break-all font-mono">
                {value.sol.amount} SOL ({value.sol.lamports} lamports)
              </dd>
            </div>
            <div>
              <dt className="text-text-tertiary">SOL context slot</dt>
              <dd>{value.sol.contextSlot}</dd>
            </div>
            <div>
              <dt className="text-text-tertiary">Observation time (UTC)</dt>
              <dd>
                <time dateTime={value.observedAt}>
                  {new Date(value.observedAt).toISOString()}
                </time>
              </dd>
            </div>
            <div>
              <dt className="text-text-tertiary">Public RPC source</dt>
              <dd className="break-all">
                {value.endpointHost} · mainnet-beta · confirmed
              </dd>
            </div>
          </dl>
          {[value.splToken, value.token2022].map((program) => (
            <section
              key={program.programId}
              aria-label={`${program.program} public holdings`}
            >
              <h3 className="font-semibold">
                {program.program === "spl-token" ? "SPL Token" : "Token-2022"}{" "}
                holdings · slot {program.contextSlot}
              </h3>
              {program.mints.length === 0 ? (
                <p className="mt-2 text-sm text-text-tertiary">
                  No token accounts were returned for this program at this
                  observation.
                </p>
              ) : (
                <ul className="mt-2 grid gap-3">
                  {program.mints.map((holding) => (
                    <li
                      key={holding.mint}
                      className="min-w-0 rounded-xl border border-border-tertiary p-3 text-sm"
                    >
                      <p className="break-all font-mono">{holding.mint}</p>
                      <p className="mt-1 break-all">
                        Exact quantity:{" "}
                        <span className="font-mono">{holding.amount}</span>
                      </p>
                      <p className="break-all text-text-tertiary">
                        Raw units: {holding.rawAmount} · decimals:{" "}
                        {holding.decimals} · accounts: {holding.accountCount}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          <p className="text-sm leading-6 text-text-tertiary">
            The three RPC reads may observe different slots. Holdings include
            returned frozen or uninitialized token accounts and do not establish
            spendability, eligibility, payout authority, token legitimacy or
            claimable value. No prices or totals across token mints are
            inferred.
          </p>
          <Link
            className="text-sm font-semibold text-text-accent underline"
            href={`/portfolio?${new URLSearchParams({ address })}`}
          >
            Open the full public account inventory
          </Link>
        </div>
      )}
    </section>
  );
}
