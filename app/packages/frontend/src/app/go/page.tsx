import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { loadGoEvidence } from "./evidence";
import GoExplorer from "./go-explorer";
import {
  GoQueryError,
  normalizeGoQuery,
  queryArchivedBounties,
  type GoPageResult,
} from "./go-data";
import "./go.css";

export const metadata: Metadata = {
  title: "GO bounty discovery",
  description:
    "Explore a verified historical GO bounty snapshot without wallet or production mutations.",
};

type GoPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function toSearchParams(
  values: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value))
      value.forEach((item) => parameters.append(key, item));
    else if (value !== undefined) parameters.set(key, value);
  }
  return parameters;
}

function ExplorerFallback() {
  return (
    <section className="go-loading" role="status" aria-live="polite">
      <span aria-hidden="true" />
      Loading authenticated bounty archive…
    </section>
  );
}

export default async function GoPage({ searchParams }: GoPageProps) {
  const evidence = await loadGoEvidence();
  const normalized = normalizeGoQuery(toSearchParams(await searchParams));
  let rejectedCursor = normalized.invalidCursor;
  let initialPage: GoPageResult | undefined;
  if (evidence.ok && !rejectedCursor) {
    try {
      initialPage = queryArchivedBounties(evidence.snapshot, normalized.query);
    } catch (error) {
      if (!(error instanceof GoQueryError)) throw error;
      rejectedCursor = true;
    }
  }

  return (
    <section className="go-page" aria-labelledby="go-title">
      <header className="go-header">
        <div>
          <p className="eyebrow">Archived first-party evidence</p>
          <h1 id="go-title">GO bounties</h1>
          <p className="description">
            Discover bounties recorded in the authenticated Pump GO capture.
            This is a historical, read-only view—not a live bounty service.
          </p>
        </div>
        <span className="go-boundary-badge">No wallet or payouts</span>
      </header>

      {evidence.ok && !rejectedCursor && initialPage ? (
        <>
          <aside
            className="go-snapshot-note"
            aria-label="Bounty snapshot provenance"
          >
            <strong>Authenticated local snapshot</strong>
            <span>
              Captured{" "}
              <time dateTime={evidence.snapshot.capturedAt}>
                {evidence.snapshot.capturedAt}
              </time>
            </span>
            <span>
              {evidence.snapshot.bounties.length} exact archived bounties
            </span>
          </aside>
          <Suspense fallback={<ExplorerFallback />}>
            <GoExplorer
              initialPage={initialPage}
              initialQuery={normalized.query}
              ignoredInvalidState={normalized.ignoredInvalidState}
            />
          </Suspense>
          <footer className="go-provenance">
            Source: captured first-party <code>/go</code> HTML. SHA-256{" "}
            <code>{evidence.snapshot.sha256}</code>. No external images, live
            API, wallet, submission, funding or payout action is enabled.
          </footer>
        </>
      ) : evidence.ok ? (
        <section
          className="go-failure"
          role="alert"
          data-testid="go-query-error"
        >
          <p className="go-kicker">Rejected query state</p>
          <h2>GO cursor rejected</h2>
          <p>
            The cursor is not canonical or is outside this result set. No
            first-page fallback was rendered.
          </p>
          <Link className="go-primary" href="/go">
            Return to first page
          </Link>
        </section>
      ) : (
        <section
          className="go-failure"
          role="alert"
          data-testid="go-evidence-error"
        >
          <p className="go-kicker">Fail-closed evidence adapter</p>
          <h2>Archived GO snapshot unavailable</h2>
          <p>
            The retained page did not pass provenance, hash and schema checks.
            No synthetic listing or production fallback was used.
          </p>
        </section>
      )}
    </section>
  );
}
