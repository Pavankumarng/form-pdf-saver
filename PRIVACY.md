# Privacy Policy — Form PDF Saver

**Last updated: November 2026**

---

## Plain-Language Summary

Form PDF Saver is a browser extension that works **entirely inside your browser**. It reads the answers you type into a Google Form and helps you save them as a PDF file — nothing more.

**Your data never leaves your device.**

---

## What Data Is Processed

When you use Form PDF Saver, the extension reads:

- The **title** of the Google Form you have open.
- The **text of each question** displayed on the form.
- The **answers you have entered** into the form fields (text, selections, dates, etc.).

This data is processed only to build the PDF document you download.

---

## What Data Is Stored

The extension stores your in-progress answers in your browser's **`sessionStorage`** — a temporary memory area that is:

- **Scoped to the current browser tab** only.
- **Automatically erased** when you close the tab or the browser.
- **Never shared** with any other tab, window, or website.
- **Never written** to `localStorage`, cookies, or any browser profile storage that persists across sessions.

The sessionStorage key is `formpdf:<form-path>`. Its sole purpose is to preserve answers across the multi-section navigation within a single form session (since Google removes earlier sections from the page when you click "Next").

---

## What Data Is Collected

**Nothing.** The extension does not collect, aggregate, or store any data about you or your usage.

- No analytics.
- No crash reporting.
- No telemetry.
- No usage statistics.
- No identifiers of any kind.

---

## Network Transmissions

**Zero network requests are made — ever.**

- The extension runs entirely in your browser as a content script.
- It has **no background service worker** that could make outbound requests.
- The PDF generation library (`jsPDF`) is bundled **locally** in the extension package — it is never fetched from the internet.
- The manifest declares no host permissions beyond the `matches` rule that lets the content script run on `https://docs.google.com/forms/*`.

---

## Third-Party Services

None. The extension does not communicate with any third-party server, API, or service.

---

## Extension Permissions

Form PDF Saver requests **zero browser permissions**. The only access it has is the content script's inherent ability to read the DOM of pages matching `https://docs.google.com/forms/*`, as declared in the extension manifest.

---

## Answers You Do Not Submit to Google

This extension **only reads** the form — it never modifies, submits, or intercepts the form's submission to Google. When you click "Submit" in the Google Form, your answers go directly to Google's servers exactly as they would without the extension.

---

## Changes to This Policy

If a future version of Form PDF Saver adds any data handling, this document will be updated and the change will be clearly described in the release notes.

---

## Contact

This extension is an open-source project. If you have privacy concerns, please open an issue in the project repository.
