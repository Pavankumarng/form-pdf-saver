/**
 * ui.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Injects and manages the "Save answers as PDF" floating button and the
 * toast notification system. Everything lives inside an open Shadow DOM so:
 *   • Google's CSS cannot reach our elements (no style leakage in).
 *   • Our CSS cannot bleed into the form (no style leakage out).
 *
 * PUBLIC API  (attached to window.FormPDF)
 * ──────────────────────────────────────────────────────────────
 *   mountButton({ label, onClick })
 *       Injects the floating button with the given label and click handler.
 *       If called again, replaces the previous button's label and handler.
 *       Safe to call multiple times (idempotent host element, new button each
 *       call so callers can swap handlers between /viewform and /formResponse).
 *
 *   showToast(message, durationMs = 3000)
 *       Briefly shows a small notification above the button.
 *       Multiple calls stack; each toast auto-dismisses.
 *
 * SHADOW DOM STRUCTURE
 * ────────────────────
 *   <div id="formpdf-host">   ← fixed host, appended to document.body
 *     #shadow-root (open)
 *       <style>…</style>
 *       <div id="formpdf-toast-stack">   ← toasts appended here
 *       <button id="formpdf-btn">…</button>
 *
 * CONSTRAINTS
 * ───────────
 *   • No ES module syntax.
 *   • No class names from Google's DOM.
 *   • Errors logged with "[FormPDF]" prefix.
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function attachUI() {
  "use strict";

  window.FormPDF = window.FormPDF || {};

  // ── Constants ────────────────────────────────────────────────────────────────

  /** id of the Shadow DOM host element we append to document.body. */
  const HOST_ID = "formpdf-host";

  /** id of the <button> inside the shadow root. */
  const BTN_ID = "formpdf-btn";

  /** id of the toast container inside the shadow root. */
  const TOAST_STACK_ID = "formpdf-toast-stack";

  // ── CSS injected into the Shadow DOM ─────────────────────────────────────────

  const SHADOW_CSS = `
    :host {
      all: initial;
    }

    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }

    /* ── Floating button ─────────────────────────────────────────────────── */

    #${BTN_ID} {
      /* Layout */
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647; /* max z-index */

      /* Crucial: host element has pointer-events: none, so button MUST enable them */
      pointer-events: auto !important;

      /* Sizing */
      padding: 12px 20px;
      min-width: 180px;
      max-width: 280px;

      /* Typography */
      font-family: "Google Sans", Roboto, Arial, sans-serif;
      font-size: 14px;
      font-weight: 600;
      line-height: 1.4;
      letter-spacing: 0.01em;
      white-space: nowrap;

      /* Colours — high-contrast accessible palette */
      color: #ffffff;
      background-color: #1a73e8;   /* Google blue */
      border: none;
      border-radius: 24px;         /* pill shape */

      /* Interaction */
      cursor: pointer !important;
      user-select: none;
      -webkit-user-select: none;

      /* Shadow so the button lifts above Google's content */
      box-shadow:
        0 1px 3px 0 rgba(60, 64, 67, 0.3),
        0 4px 8px 3px rgba(60, 64, 67, 0.15);

      /* Smooth transitions for hover / focus / disabled states */
      transition:
        background-color 120ms ease,
        box-shadow 120ms ease,
        opacity 120ms ease;
    }

    #${BTN_ID}:hover:not(:disabled) {
      background-color: #1765cc;
      box-shadow:
        0 2px 6px 2px rgba(60, 64, 67, 0.3),
        0 6px 12px 4px rgba(60, 64, 67, 0.15);
    }

    /* Visible keyboard-focus ring (accessibility) */
    #${BTN_ID}:focus-visible {
      outline: 3px solid #0b57d0;
      outline-offset: 3px;
    }

    /* Remove default :focus ring (we use :focus-visible instead) */
    #${BTN_ID}:focus:not(:focus-visible) {
      outline: none;
    }

    #${BTN_ID}:disabled {
      background-color: #80868b;
      cursor: not-allowed !important;
      box-shadow: none;
      opacity: 0.75;
      pointer-events: auto !important;
    }

    /* ── Toast stack ─────────────────────────────────────────────────────── */

    #${TOAST_STACK_ID} {
      position: fixed;
      bottom: 80px;   /* sits above the button */
      right: 24px;
      z-index: 2147483647;

      display: flex;
      flex-direction: column-reverse; /* newest toast on top */
      gap: 8px;

      pointer-events: none; /* stack itself doesn't block clicks */
    }

    /* Individual toast chip */
    .formpdf-toast {
      pointer-events: auto;
      padding: 10px 16px;
      border-radius: 8px;
      background-color: #202124;
      color: #e8eaed;
      font-family: "Google Sans", Roboto, Arial, sans-serif;
      font-size: 13px;
      font-weight: 500;
      line-height: 1.4;
      max-width: 280px;
      word-break: break-word;

      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);

      /* Fade-in */
      animation: formpdf-fadein 180ms ease forwards;
    }

    /* Fade-out class added before removal */
    .formpdf-toast-fade-out {
      animation: formpdf-fadeout 220ms ease forwards;
    }

    @keyframes formpdf-fadein {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0);   }
    }

    @keyframes formpdf-fadeout {
      from { opacity: 1; transform: translateY(0);   }
      to   { opacity: 0; transform: translateY(-4px);}
    }
  `;

  // ── Shadow DOM setup ─────────────────────────────────────────────────────────

  function getHost() {
    return document.getElementById(HOST_ID);
  }

  function ensureHost() {
    let host = getHost();
    if (host && host.shadowRoot) {
      return {
        host,
        shadow:     host.shadowRoot,
        toastStack: host.shadowRoot.getElementById(TOAST_STACK_ID),
      };
    }

    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.cssText = "all: unset; pointer-events: none;";

    const shadow = host.attachShadow({ mode: "open" });

    const styleEl = document.createElement("style");
    styleEl.textContent = SHADOW_CSS;
    shadow.appendChild(styleEl);

    const toastStack = document.createElement("div");
    toastStack.id = TOAST_STACK_ID;
    shadow.appendChild(toastStack);

    (document.body || document.documentElement).appendChild(host);

    return { host, shadow, toastStack };
  }

  // ── SPA guard — re-inject host if removed ────────────────────────────────────

  let _bodyObserver = null;

  function watchForHostRemoval(reinjectCallback) {
    if (_bodyObserver) {
      _bodyObserver.disconnect();
      _bodyObserver = null;
    }

    _bodyObserver = new MutationObserver(function (mutations) {
      for (const mutation of mutations) {
        for (const removed of mutation.removedNodes) {
          if (removed.id === HOST_ID) {
            try {
              reinjectCallback();
            } catch (err) {
              console.warn("[FormPDF] re-inject after host removal failed:", err);
            }
            return;
          }
        }
      }
    });

    const target = document.body || document.documentElement;
    if (target) {
      _bodyObserver.observe(target, { childList: true });
    }
  }

  // ── Public: mountButton ───────────────────────────────────────────────────────

  window.FormPDF.mountButton = function mountButton({ label, onClick } = {}) {
    const btnLabel = (typeof label === "string" && label.trim())
      ? label.trim()
      : "Save answers as PDF";

    if (typeof onClick !== "function") {
      console.warn("[FormPDF] mountButton: onClick must be a function.");
      return;
    }

    try {
      const { shadow } = ensureHost();

      const existing = shadow.getElementById(BTN_ID);
      if (existing) existing.remove();

      const btn = document.createElement("button");
      btn.id              = BTN_ID;
      btn.type            = "button";
      btn.textContent     = btnLabel;
      btn.setAttribute("aria-label", btnLabel);

      btn.addEventListener("click", async function handleClick(evt) {
        evt.stopPropagation();
        evt.preventDefault();

        if (btn.disabled) return;

        const originalLabel = btn.textContent;
        btn.disabled    = true;
        btn.textContent = "Working…";
        btn.setAttribute("aria-label", "Working…");

        try {
          await onClick();
        } catch (err) {
          console.error("[FormPDF] button onClick error:", err);
          window.FormPDF.showToast("Something went wrong — check the console.");
        } finally {
          if (shadow.getElementById(BTN_ID) === btn) {
            btn.disabled    = false;
            btn.textContent = originalLabel;
            btn.setAttribute("aria-label", originalLabel);
          }
        }
      });

      shadow.appendChild(btn);

      watchForHostRemoval(function reinject() {
        window.FormPDF.mountButton({ label: btnLabel, onClick });
      });

    } catch (err) {
      console.error("[FormPDF] mountButton error:", err);
    }
  };

  // ── Public: showToast ─────────────────────────────────────────────────────────

  window.FormPDF.showToast = function showToast(message, durationMs) {
    if (typeof message !== "string" || !message.trim()) return;
    const duration = (typeof durationMs === "number" && durationMs > 0)
      ? durationMs
      : 3000;

    try {
      const { toastStack } = ensureHost();

      const toast = document.createElement("div");
      toast.className   = "formpdf-toast";
      toast.textContent = message.trim();
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");

      toastStack.appendChild(toast);

      setTimeout(function fadeOut() {
        toast.classList.add("formpdf-toast-fade-out");
        setTimeout(function remove() {
          toast.remove();
        }, 240);
      }, duration);

    } catch (err) {
      console.warn("[FormPDF] showToast error:", err);
    }
  };

})(); // end IIFE
