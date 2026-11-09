/**
 * content.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Main entry point for the Form PDF Saver content script.
 *
 * PAGES HANDLED
 * ─────────────
 *   /viewform     — The respondent fills in the form.
 *                   Injects "Save answers as PDF" button.
 *                   Installs a submit safety-net to capture final answers.
 *
 *   /formResponse — The confirmation page shown after submitting.
 *                   If saved answers exist in sessionStorage, injects
 *                   "Download PDF of what I submitted" button.
 *
 *   SPA Support   — Google Forms can transition from /viewform to
 *                   /formResponse without a full page reload. This script
 *                   watches for URL changes and switches UI states seamlessly.
 *
 * LOAD ORDER (declared in manifest.json)
 * ───────────────────────────────────────
 *   lib/jspdf.umd.min.js → src/selectors.js → src/extractor.js
 *   → src/state.js → src/pdf.js → src/ui.js → THIS FILE
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function attachContent() {
  "use strict";

  window.FormPDF = window.FormPDF || {};

  let currentActiveRoute = null;

  // ── Helper: wait for a DOM element to appear ──────────────────────────────────

  function waitForElement(selector, timeoutMs) {
    timeoutMs = timeoutMs || 8000;

    return new Promise(function (resolve, reject) {
      const existing = document.querySelector(selector);
      if (existing) return resolve(existing);

      let timer = null;

      const observer = new MutationObserver(function () {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          if (timer) clearTimeout(timer);
          resolve(el);
        }
      });

      const root = document.documentElement || document.body;
      if (root) {
        observer.observe(root, { childList: true, subtree: true });
      }

      timer = setTimeout(function () {
        observer.disconnect();
        reject(new Error("[FormPDF] Timed out waiting for: " + selector));
      }, timeoutMs);
    });
  }

  // ── Helper: resolve form title ────────────────────────────────────────────────

  function resolveFormTitle() {
    try {
      const saved = window.FormPDF.getSavedFormTitle
        ? window.FormPDF.getSavedFormTitle()
        : "";
      if (saved && saved.trim() && !/response.*recorded/i.test(saved)) {
        return saved.trim();
      }
    } catch (e) {}

    try {
      const live = window.FormPDF.getFormTitle
        ? window.FormPDF.getFormTitle()
        : "";
      if (live && live.trim() && !/response.*recorded/i.test(live)) {
        return live.trim();
      }
    } catch (e) {}

    return "Google Form Answers";
  }

  // ── /viewform logic ───────────────────────────────────────────────────────────

  function installSubmitSafetyNet() {
    document.addEventListener("click", function onDocClick(evt) {
      try {
        const target = evt.target;
        if (!target || typeof target.closest !== "function") return;

        const btn = target.closest('[role="button"], button, input[type="submit"]');
        if (!btn) return;

        const label = (
          btn.getAttribute("aria-label") ||
          btn.textContent ||
          ""
        ).trim();

        // Check if button text matches submit or send
        if (/submit|send|envoyer|enviar|kirim|senden/i.test(label) || btn.getAttribute("type") === "submit") {
          try {
            window.FormPDF.snapshotNow();
          } catch (snapErr) {
            console.warn("[FormPDF] submit safety-net snapshotNow error:", snapErr);
          }

          // Schedule route checks in case Google transitions without full reload
          setTimeout(checkCurrentRoute, 500);
          setTimeout(checkCurrentRoute, 1500);
          setTimeout(checkCurrentRoute, 3000);
        }
      } catch (err) {
        console.warn("[FormPDF] submit safety-net click handler error:", err);
      }
    }, { capture: true });
  }

  function buildViewformClickHandler() {
    return async function onSavePdfClick() {
      try {
        // Snapshot synchronously first so Submit/Next button answers are captured
        window.FormPDF.snapshotNow();

        // Wait for Google Forms' internal handlers to finish toggling aria-checked="true"
        // before reading the final answer state from the Map.
        await new Promise(function (r) { setTimeout(r, 160); });

        const entries = window.FormPDF.getAll
          ? window.FormPDF.getAll()
          : [];

        if (!entries || entries.length === 0) {
          window.FormPDF.showToast(
            "No answers found — try filling in at least one field first."
          );
          return;
        }

        const formTitle = resolveFormTitle();
        window.FormPDF.generatePdf({ formTitle, entries });
        window.FormPDF.showToast("PDF saved — check your Downloads folder.", 4000);

      } catch (err) {
        console.error("[FormPDF] onSavePdfClick error:", err);
        window.FormPDF.showToast("Something went wrong generating the PDF.");
      }
    };
  }

  async function initViewform() {
    try {
      const S = window.FormPDF.SELECTORS || {};
      const titleSelector = S.FORM_TITLE || '[role="heading"][aria-level="1"]';

      // Wait up to 8s for form heading, but don't hard crash if it's slow
      try {
        await waitForElement(titleSelector, 8000);
      } catch (_) {}

      const liveTitle = window.FormPDF.getFormTitle
        ? window.FormPDF.getFormTitle()
        : "";
      if (liveTitle && liveTitle !== "Untitled Form" && !/response.*recorded/i.test(liveTitle)) {
        window.FormPDF.setSavedFormTitle(liveTitle);
      }

      window.FormPDF.mountButton({
        label:   "Save answers as PDF",
        onClick: buildViewformClickHandler(),
      });

      installSubmitSafetyNet();
      console.log("[FormPDF] /viewform initialised.");

    } catch (err) {
      console.warn("[FormPDF] initViewform error:", err);
    }
  }

  // ── /formResponse logic ───────────────────────────────────────────────────────

  async function initFormResponse() {
    try {
      let entries = window.FormPDF.getAll
        ? window.FormPDF.getAll()
        : [];

      if (!entries || entries.length === 0) {
        console.log("[FormPDF] /formResponse: no saved answers found, skipping.");
        return;
      }

      console.log(
        "[FormPDF] /formResponse: " + entries.length +
        " saved answer(s) found — mounting download button."
      );

      window.FormPDF.mountButton({
        label:   "Download PDF of what I submitted",
        onClick: async function onDownloadClick() {
          try {
            const formTitle = resolveFormTitle();
            const savedEntries = window.FormPDF.getAll
              ? window.FormPDF.getAll()
              : [];

            if (!savedEntries || savedEntries.length === 0) {
              window.FormPDF.showToast("No saved answers found for this form.");
              return;
            }

            window.FormPDF.generatePdf({ formTitle, entries: savedEntries });
            window.FormPDF.showToast("PDF saved — check your Downloads folder.", 4000);

            // Re-mount button with updated label, but keep download capability active!
            window.FormPDF.mountButton({
              label:   "Download PDF again ✓",
              onClick: onDownloadClick,
            });

          } catch (err) {
            console.error("[FormPDF] onDownloadClick error:", err);
            window.FormPDF.showToast("Something went wrong generating the PDF.");
          }
        },
      });

    } catch (err) {
      console.warn("[FormPDF] initFormResponse error:", err);
    }
  }

  // ── SPA / Route watcher ───────────────────────────────────────────────────────

  function checkCurrentRoute() {
    const path = window.location.pathname;
    const isViewform = path.indexOf("/viewform") !== -1;
    const isFormResponse = path.indexOf("/formResponse") !== -1;

    let targetRoute = null;
    if (isFormResponse) {
      targetRoute = "formResponse";
    } else if (isViewform) {
      targetRoute = "viewform";
    }

    if (targetRoute && targetRoute !== currentActiveRoute) {
      currentActiveRoute = targetRoute;
      if (targetRoute === "viewform") {
        initViewform();
      } else if (targetRoute === "formResponse") {
        initFormResponse();
      }
    }
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────────

  (function bootstrap() {
    try {
      checkCurrentRoute();

      // Watch for SPA history state changes
      window.addEventListener("popstate", checkCurrentRoute);

      // Polling fallback to catch in-place DOM/URL updates without page reload
      setInterval(checkCurrentRoute, 800);
    } catch (err) {
      console.error("[FormPDF] content.js bootstrap error:", err);
    }
  })();

})(); // end IIFE
