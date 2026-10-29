"use client";

import { useEffect, useId, useRef, useState } from "react";
import { lockBodyScroll } from "@/lib/body-scroll-lock";
import { getDevicePrivacyPreference } from "@/components/settings/privacy-setting-control";
import { outboundConfirmation } from "../../../../reconstruction/privacy-external-links/client.mjs";
import styles from "./create-draft-links.module.css";

type Controller = ReturnType<typeof outboundConfirmation>;

/** Only validated links in the local Create preview use this captured policy. */
export function CreateDraftLinks({
  links,
}: {
  links: readonly { label: string; href: string }[];
}) {
  const controller = useRef<Controller | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<ReturnType<
    Controller["getSnapshot"]
  > | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const current = outboundConfirmation({
      preference: getDevicePrivacyPreference(),
      // Local integration decision: this shell already exposes the device switch.
      // This is not a claim about the upstream WEB_SETTINGS_HUB rollout.
      settingsHubEnabled: true,
      openWindow: (url, target, features) => window.open(url, target, features),
    });
    controller.current = current;
    const unsubscribe = current.subscribe(() =>
      setState(current.getSnapshot()),
    );
    setState(current.getSnapshot());
    return () => {
      unsubscribe();
      current.dispose();
      controller.current = null;
    };
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (!element || !state?.open) return;
    element.showModal();
    cancel.current?.focus();
    const unlock = lockBodyScroll();
    return () => {
      element.close();
      unlock();
    };
  }, [state?.open]);

  return (
    <>
      <ul className="preview-links" aria-label="Draft social links">
        {links.map((link) => (
          <li key={link.label}>
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!state}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                controller.current?.handleLinkClick(event, { href: link.href });
              }}
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onCancel={(event) => {
          event.preventDefault();
          controller.current?.cancel();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.stopPropagation();
          if (event.key !== "Tab") return;
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'input:not([disabled]), button:not([disabled]), a[href], [tabindex="0"]',
            ),
          ).filter(
            (control) =>
              control.tabIndex >= 0 && control.getClientRects().length > 0,
          );
          const first = controls[0];
          const last = controls.at(-1);
          // Native modal inertness can still let Tab leave the dialog for browser chrome.
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget)
            controller.current?.cancel();
        }}
      >
        <div className={styles.content}>
          <h2 id={titleId}>Open external link?</h2>
          <p id={descriptionId}>
            This draft link opens another website in a new tab.
          </p>
          <p className={styles.url}>{state?.pendingUrl}</p>
          <label className={styles.choice}>
            <input
              type="checkbox"
              checked={state?.dontAskAgain ?? false}
              onChange={(event) =>
                controller.current?.setDontAskAgain(event.target.checked)
              }
            />
            Do not ask again on this browser
          </label>
          <div className={styles.actions}>
            <button
              type="button"
              ref={cancel}
              onClick={() => controller.current?.cancel()}
            >
              Cancel
            </button>
            <button type="button" onClick={() => controller.current?.confirm()}>
              Open link
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
