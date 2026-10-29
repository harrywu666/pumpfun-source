"use client";

import { useEffect, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import {
  createCountdownModule,
  useMemoCache,
  type CountdownTarget,
  type CompetitionTiming,
} from "./original-countdown.mjs";

// Explicit local English labels for the captured translation-key boundary.
// This does not recreate the upstream translation provider or locale selection.
const labels: Record<string, string> = {
  "web.leaderboard.cup.ends_in": "Ends in",
  "web.leaderboard.cup.starts_in": "Starts in",
  "web.leaderboard.cup.unit_days": "Days",
  "web.leaderboard.cup.unit_hours": "Hours",
  "web.leaderboard.cup.unit_minutes": "Minutes",
  "web.leaderboard.cup.unit_seconds": "Seconds",
};
function translate(key: string): string {
  const value = labels[key];
  if (value === undefined) throw new Error("Unsupported countdown label");
  return value;
}
const { Countdown, selectTarget } = createCountdownModule({
  jsx,
  jsxs,
  useMemoCache,
  useState,
  useEffect,
  useTranslation: () => ({ t: translate }),
  Date,
  setInterval: globalThis.setInterval.bind(globalThis),
  clearInterval: globalThis.clearInterval.bind(globalThis),
});

const MAX_TIMEOUT_MS = 2_147_483_647;

function targetAt(
  competition: CompetitionTiming,
  nowMs: number,
): CountdownTarget | null {
  const target = selectTarget(competition);
  if (!target || nowMs < target.atMs) return target;
  if (target.kind === "starts") {
    const endsAt = competition.endsAt
      ? Date.parse(competition.endsAt)
      : Number.NaN;
    if (Number.isFinite(endsAt) && nowMs < endsAt)
      return { kind: "ends", atMs: endsAt };
  }
  return null;
}

/** Local card adapter: pass documented DTO fields to the actual source selector. */
export function CompetitionCountdown({
  competition,
}: {
  competition?: CompetitionTiming | null;
}) {
  const [target, setTarget] = useState<CountdownTarget | null>(() =>
    competition ? selectTarget(competition) : null,
  );

  useEffect(() => {
    if (!competition) {
      setTarget(null);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const nowMs = Date.now();
      const next = targetAt(competition, nowMs);
      setTarget(next);
      if (!next) return;
      timer = setTimeout(
        schedule,
        Math.min(Math.max(0, next.atMs - nowMs), MAX_TIMEOUT_MS),
      );
    };
    schedule();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [competition]);

  if (!target) return null;
  return (
    <div className="mb-4">
      <Countdown target={target} />
    </div>
  );
}
