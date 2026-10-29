"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import { pumpButtonClass } from "@/components/ui/pump-button";
import {
  acceptClickwrap,
  CLICKWRAP_ACCEPTED_EVENT,
  isClickwrapOutOfScope,
  migrateClickwrapLegacy,
  readClickwrapAccepted,
  stopClickwrapPrepaintObserver,
  type ClickwrapEnvironment,
} from "./clickwrap";
const subscribers = new Set<() => void>();
let acceptedChannel: BroadcastChannel | null = null;
function notifySubscribers() {
  for (const listener of subscribers) listener();
}
function ensureAcceptedChannel() {
  if (acceptedChannel || typeof BroadcastChannel === "undefined") return;
  try {
    acceptedChannel = new BroadcastChannel(CLICKWRAP_ACCEPTED_EVENT);
    acceptedChannel.addEventListener("message", notifySubscribers);
  } catch {
    acceptedChannel = null;
  }
}
function environment(): ClickwrapEnvironment {
  return {
    getCookie: () => document.cookie,
    setCookie: (value) => {
      document.cookie = value;
    },
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    now: () => new Date(),
    notifyAccepted: () => {
      notifySubscribers();
      window.dispatchEvent(new Event(CLICKWRAP_ACCEPTED_EVENT));
      try {
        acceptedChannel?.postMessage(null);
      } catch {
        /* Focus and visibility listeners remain the cookie-only fallback. */
      }
    },
  };
}
function subscribe(listener: () => void) {
  subscribers.add(listener);
  ensureAcceptedChannel();
  window.addEventListener("storage", listener);
  // Cookie consent remains shared when local storage writes are unavailable.
  // Re-read it when this tab becomes active again.
  window.addEventListener("focus", listener);
  document.addEventListener("visibilitychange", listener);
  return () => {
    subscribers.delete(listener);
    window.removeEventListener("storage", listener);
    window.removeEventListener("focus", listener);
    document.removeEventListener("visibilitychange", listener);
    if (subscribers.size === 0) {
      acceptedChannel?.close();
      acceptedChannel = null;
    }
  };
}
const snapshot = () => readClickwrapAccepted(environment());
const serverSnapshot = () => false;
const focusable =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** Original dismiss controls record the same preference as Continue. */
export function ClickwrapDialog() {
  const pathname = usePathname(),
    accepted = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [acceptedHere, setAcceptedHere] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const outOfScope = isClickwrapOutOfScope(pathname),
    visible = !accepted && !acceptedHere && !outOfScope;
  useEffect(() => {
    document.documentElement.toggleAttribute("data-clickwrap-oos", outOfScope);
  }, [outOfScope]);
  useEffect(() => {
    migrateClickwrapLegacy(environment());
  }, []);
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>("[data-app-shell]");
    stopClickwrapPrepaintObserver();
    if (!visible) {
      shell?.removeAttribute("inert");
      return;
    }
    const root = document.documentElement,
      previousOverflow = root.style.overflow;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    root.style.overflow = "hidden";
    const protect = () => {
      const current = document.querySelector("[data-app-shell]");
      if (current && !current.hasAttribute("inert"))
        current.setAttribute("inert", "");
    };
    protect();
    const observer = new MutationObserver(protect);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["inert"],
    });
    panel.current?.focus();
    const keepFocus = (event: FocusEvent) => {
      if (
        event.target instanceof Element &&
        !panel.current?.contains(event.target) &&
        event.target.closest("[data-app-shell]")
      )
        (
          panel.current?.querySelector<HTMLElement>(focusable) ?? panel.current
        )?.focus();
    };
    document.addEventListener("focusin", keepFocus);
    return () => {
      observer.disconnect();
      root.style.overflow = previousOverflow;
      document.querySelector("[data-app-shell]")?.removeAttribute("inert");
      document.removeEventListener("focusin", keepFocus);
      previousFocus?.focus();
    };
  }, [visible]);
  function accept() {
    setAcceptedHere(true);
    acceptClickwrap(environment());
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      accept();
      return;
    }
    // Local accessibility addition: wrap Tab inside captured modal content.
    if (event.key !== "Tab") return;
    const controls = Array.from(
        panel.current?.querySelectorAll<HTMLElement>(focusable) ?? [],
      ),
      first = controls[0],
      last = controls.at(-1);
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        document.activeElement === panel.current)
    ) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  if (!visible) return null;
  return (
    <div
      aria-describedby="clickwrap-description"
      aria-labelledby="clickwrap-title"
      aria-modal="true"
      className="fixed inset-0 z-[999] flex items-center justify-center p-6 max-[640px]:items-end max-[640px]:p-0"
      data-clickwrap-overlay=""
      role="dialog"
      onKeyDown={onKeyDown}
    >
      {/* Original quirk: backdrop Dismiss records the same preference as Continue. */}
      <button
        aria-label="Dismiss"
        className="absolute inset-0 cursor-default bg-black/75"
        tabIndex={-1}
        type="button"
        onClick={accept}
      />
      <div
        className="relative flex max-h-[100dvh] overflow-y-auto w-full max-w-[640px] flex-col bg-bg-primary p-6 shadow-[0_0_0_1px_var(--color-border-secondary)] rounded-[16px] max-[640px]:rounded-b-none max-[640px]:rounded-t-[24px]"
        ref={panel}
        tabIndex={-1}
      >
        {/* The cover image (/dialog-clickwrap-cover.webp) is not in the capture; keep its 592x333 box. */}
        <div
          aria-hidden="true"
          className="aspect-[592/333] w-full rounded-xl border border-solid border-border-secondary bg-bg-secondary max-[640px]:rounded-[20px]"
        />
        <div className="_1AbQgq_spacer" style={{ height: 24 }} />
        <p
          className="font-bold text-2xl text-text-primary text-center"
          id="clickwrap-title"
        >
          Welcome to Pump<span className="text-text-accent">.</span>fun!
        </p>
        <div className="_1AbQgq_spacer" style={{ height: 16 }} />
        <p
          className="text-text-tertiary text-center"
          id="clickwrap-description"
        >
          Pump lets anyone create coins, giving everyone equal access to buy and
          sell from the start. Prices can move quickly, so trade carefully.
        </p>
        <div className="_1AbQgq_spacer" style={{ height: 24 }} />
        <button
          aria-pressed="false"
          className={pumpButtonClass({ size: 48, width: "full" })}
          type="button"
          onClick={accept}
        >
          <span>Continue</span>
        </button>
        <div className="_1AbQgq_spacer" style={{ height: 16 }} />
        <p className="text-xs text-text-tertiary mx-auto max-w-[480px] text-center">
          By clicking this button, you agree to the{" "}
          <Link
            prefetch={false}
            className="underline"
            href="/docs/terms-and-conditions"
          >
            Terms and Conditions
          </Link>
          ,{" "}
          <Link
            prefetch={false}
            className="underline"
            href="/docs/privacy-policy"
          >
            Privacy Policy
          </Link>
          , and certify that you are over 18 years old.
        </p>
        <p
          className="mt-3 text-xs text-text-tertiary text-center"
          data-local-consent-notice=""
        >
          Archived interface; continuing saves a local browser preference.
        </p>
      </div>
    </div>
  );
}
