/**
 * state.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Persistent, cross-section state manager for Form PDF Saver.
 *
 * PROBLEM BEING SOLVED
 * ────────────────────
 * Google Forms is multi-section. When the respondent clicks "Next":
 *   • Earlier questions are removed from the DOM (answers gone from JS).
 * When the respondent clicks "Submit":
 *   • The page navigates to /formResponse — all in-memory JS is wiped.
 * Also, event handlers in Google Forms toggle aria-checked="true" asynchronously
 * after native click/input events are dispatched.
 *
 * SOLUTION
 * ─────────
 * 1. An in-memory Map (questionMap) accumulates answers across sections,
 *    keyed by stable question id. Insertion order is preserved by Map iteration.
 * 2. After every mutation, the Map is serialised to sessionStorage under a
 *    normalized key so the data survives the submit navigation.
 * 3. On script initialisation, any existing sessionStorage snapshot is
 *    immediately hydrated back into the Map.
 * 4. Event delegation (input/change/click) captures both synchronously AND
 *    with follow-up delays (50ms, 150ms, 300ms) so DOM changes made by Google's
 *    handlers (such as aria-checked="true") are reliably captured.
 *
 * PUBLIC API  (all attached to window.FormPDF)
 * ────────────────────────────────────────────
 *   snapshotNow()          — read DOM, merge into Map, persist to storage.
 *   getAll()               — ordered array of all captured questions.
 *   clear()                — wipe Map + sessionStorage entry.
 *   getSavedFormTitle()    — retrieve persisted form title string.
 *   setSavedFormTitle(t)   — persist a form title string.
 *
 * DEPENDENCIES  (globals loaded before this script)
 * ──────────────────────────────────────────────────
 *   window.FormPDF.SELECTORS          — src/selectors.js
 *   window.FormPDF.extractCurrentPage — src/extractor.js
 *   window.FormPDF.getFormTitle       — src/extractor.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function attachState() {
  "use strict";

  window.FormPDF = window.FormPDF || {};

  // ── Storage key ─────────────────────────────────────────────────────────────

  function normalizePath(pathname) {
    let p = (pathname || "").split("?")[0].split("#")[0];
    p = p.replace(/\/u\/\d+\//i, "/");
    p = p.replace(/\/(viewform|formResponse)(\/.*)?$/i, "");
    return p;
  }

  // v2: bumped prefix to invalidate any corrupt snapshots from earlier versions
  const STORAGE_PREFIX = "formpdf_v2:";

  const STORAGE_KEY = (function buildStorageKey() {
    try {
      return STORAGE_PREFIX + normalizePath(location.pathname);
    } catch (e) {
      console.warn("[FormPDF] Could not build storage key:", e);
      return STORAGE_PREFIX + "unknown";
    }
  })();

  // ── In-memory store ─────────────────────────────────────────────────────────

  let questionMap = new Map();
  let savedFormTitle = "";

  // ── sessionStorage helpers ───────────────────────────────────────────────────

  function storageRead() {
    try {
      let raw = window.sessionStorage.getItem(STORAGE_KEY);

      if (!raw) {
        const idMatch = location.pathname.match(/\/([a-zA-Z0-9_-]{15,})/);
        const formId = idMatch ? idMatch[1] : null;

        for (let i = 0; i < window.sessionStorage.length; i++) {
          const k = window.sessionStorage.key(i);
          if (k && k.startsWith(STORAGE_PREFIX)) {
            if (!formId || k.includes(formId)) {
              raw = window.sessionStorage.getItem(k);
              if (raw) break;
            }
          }
        }
      }

      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (!Array.isArray(parsed.questions)) return null;
      return parsed;
    } catch (err) {
      console.warn("[FormPDF] sessionStorage read failed:", err);
      return null;
    }
  }

  function storageWrite() {
    try {
      const payload = {
        formTitle: savedFormTitle,
        questions: [...questionMap.values()],
      };
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn("[FormPDF] sessionStorage write failed:", err);
    }
  }

  function storageClear() {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
      const idMatch = location.pathname.match(/\/([a-zA-Z0-9_-]{15,})/);
      const formId = idMatch ? idMatch[1] : null;
      if (formId) {
        const toRemove = [];
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const k = window.sessionStorage.key(i);
          if (k && k.startsWith(STORAGE_PREFIX) && k.includes(formId)) {
            toRemove.push(k);
          }
        }
        toRemove.forEach((k) => window.sessionStorage.removeItem(k));
      }
    } catch (err) {
      console.warn("[FormPDF] sessionStorage clear failed:", err);
    }
  }

  // ── Hydration on load ────────────────────────────────────────────────────────

  function hydrateFromStorage() {
    const stored = storageRead();
    if (!stored) return;

    try {
      if (stored.formTitle && typeof stored.formTitle === "string" && stored.formTitle.trim()) {
        savedFormTitle = stored.formTitle.trim();
      }

      for (const q of stored.questions) {
        if (q && typeof q.id === "string" && q.id) {
          questionMap.set(q.id, {
            id:     q.id,
            title:  typeof q.title  === "string" ? q.title  : "",
            type:   typeof q.type   === "string" ? q.type   : "unknown",
            answer: Array.isArray(q.answer) ? q.answer
                     : typeof q.answer === "string" ? q.answer
                     : "",
          });
        }
      }

      console.log(
        "[FormPDF] Hydrated " + questionMap.size + " question(s) from sessionStorage."
      );
    } catch (err) {
      console.warn("[FormPDF] hydrateFromStorage error:", err);
    }
  }

  // ── Core snapshot logic ──────────────────────────────────────────────────────

  function snapshotNow() {
    try {
      // 1. Capture form title only if on viewform (not on confirmation page)
      const isConfirmation = window.location.pathname.indexOf("/formResponse") !== -1;
      if (!isConfirmation || !savedFormTitle) {
        try {
          const title = window.FormPDF.getFormTitle
            ? window.FormPDF.getFormTitle()
            : "";
          if (title && title !== "Untitled Form" && !/response.*recorded/i.test(title)) {
            savedFormTitle = title;
          }
        } catch (titleErr) {
          console.warn("[FormPDF] snapshotNow – getFormTitle error:", titleErr);
        }
      }

      // 2. Extract questions visible on this page
      let questions = [];
      try {
        questions = window.FormPDF.extractCurrentPage
          ? window.FormPDF.extractCurrentPage()
          : [];
      } catch (extractErr) {
        console.warn("[FormPDF] snapshotNow – extractCurrentPage error:", extractErr);
      }

      // 3. Merge into Map
      for (const q of questions) {
        if (!q || typeof q.id !== "string" || !q.id) continue;

        if (questionMap.has(q.id)) {
          const existing = questionMap.get(q.id);
          existing.answer = q.answer;
          existing.title  = q.title  || existing.title;
          existing.type   = q.type   || existing.type;
        } else {
          questionMap.set(q.id, {
            id:     q.id,
            title:  q.title,
            type:   q.type,
            answer: q.answer,
          });
        }
      }

      // 4. Persist
      storageWrite();

    } catch (err) {
      console.error("[FormPDF] snapshotNow error:", err);
    }
  }

  // ── Event delegation with delayed follow-ups ─────────────────────────────────

  function attachEventListeners() {
    ["input", "change", "click"].forEach(function (eventType) {
      document.addEventListener(
        eventType,
        function onUserInteraction() {
          // 1. Immediate snapshot
          snapshotNow();

          // 2. Scheduled follow-up snapshots so we capture changes AFTER
          // Google Forms' internal handlers toggle aria-checked="true",
          // data-value, or dropdown selections
          setTimeout(snapshotNow, 50);
          setTimeout(snapshotNow, 150);
          setTimeout(snapshotNow, 300);
        },
        { capture: true }
      );
    });
  }

  // ── Debounced MutationObserver — detects section navigation ─────────────────

  function debounce(fn, delayMs) {
    let timer = null;
    return function debouncedFn() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(fn, delayMs);
    };
  }

  function attachMutationObserver() {
    const debouncedSnapshot = debounce(snapshotNow, 300);

    const target = document.querySelector("form") || document.body || document.documentElement;
    if (!target) return;

    const observer = new MutationObserver(function onMutation(mutations) {
      const hasStructuralChange = mutations.some(
        (m) => m.addedNodes.length > 0 || m.removedNodes.length > 0
      );
      if (hasStructuralChange) {
        debouncedSnapshot();
        // Also follow up slightly after render completes
        setTimeout(snapshotNow, 200);
      }
    });

    observer.observe(target, {
      childList: true,
      subtree:   true,
    });
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  window.FormPDF.snapshotNow = snapshotNow;

  window.FormPDF.getAll = function getAll() {
    return [...questionMap.values()];
  };

  window.FormPDF.clear = function clear() {
    questionMap = new Map();
    savedFormTitle = "";
    storageClear();
  };

  window.FormPDF.getSavedFormTitle = function getSavedFormTitle() {
    return savedFormTitle;
  };

  window.FormPDF.setSavedFormTitle = function setSavedFormTitle(title) {
    if (typeof title === "string" && title.trim()) {
      savedFormTitle = title.trim();
      storageWrite();
    }
  };

  // ── Initialisation ───────────────────────────────────────────────────────────

  (function init() {
    try {
      hydrateFromStorage();
      attachEventListeners();
      attachMutationObserver();

      if (window.location.pathname.indexOf("/formResponse") === -1) {
        snapshotNow();
      }
    } catch (err) {
      console.error("[FormPDF] state.js init error:", err);
    }
  })();

})(); // end IIFE
