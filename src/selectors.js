/**
 * selectors.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for EVERY DOM selector used by Form PDF Saver.
 *
 * RULES:
 *  - Zero generated class names. Google's classes are hashed and change with
 *    every deployment. Use only: tag names, [role=…], [aria-*], [data-*],
 *    attribute presence, and structural pseudo-selectors.
 *  - If a Google Forms DOM update breaks something, fix it HERE only.
 *  - All values are plain selector strings so they work with
 *    querySelector / querySelectorAll directly.
 *
 * GLOBALS: Exposes window.FormPDF.SELECTORS (no ES module exports).
 * ─────────────────────────────────────────────────────────────────────────────
 */

window.FormPDF = window.FormPDF || {};

window.FormPDF.SELECTORS = {

  // ── Form title ──────────────────────────────────────────────────────────────
  // Google always marks the form title as an aria-level="1" heading.
  // Using the explicit aria-level avoids matching section headings (level 2+)
  // that appear later in the form. Stable because ARIA landmark roles are
  // part of the HTML accessibility contract, not an implementation detail.
  FORM_TITLE: '[role="heading"][aria-level="1"]',

  // ── Question containers ─────────────────────────────────────────────────────
  // The Forms renderer wraps every question in a listitem role so screen
  // readers can announce "item X of Y". Note: individual options inside a list
  // can also carry role="listitem", so extractor.js filters out nested items.
  QUESTION_CONTAINER: '[role="listitem"]',

  // ── Question title (the prompt text) ───────────────────────────────────────
  // Inside each question card the prompt text is marked as a heading.
  QUESTION_HEADING: '[role="heading"]',

  // ── Short-answer inputs ─────────────────────────────────────────────────────
  // Google renders short-text, email, number, and URL questions as native
  // <input> elements with matching HTML type attributes.
  SHORT_TEXT_INPUT:  'input[type="text"]',
  EMAIL_INPUT:       'input[type="email"]',
  NUMBER_INPUT:      'input[type="number"]',
  URL_INPUT:         'input[type="url"]',

  // ── Paragraph (long answer) ─────────────────────────────────────────────────
  // Long-answer questions use a <textarea>.
  PARAGRAPH_INPUT: 'textarea',

  // ── Multiple-choice / Linear scale (radio) ─────────────────────────────────
  // Google renders both radio groups using role="radio" on <div>/<span> elements.
  // The aria-checked="true" attribute is the authoritative selected-state signal.
  RADIO_OPTION:         '[role="radio"]',
  RADIO_OPTION_CHECKED: '[role="radio"][aria-checked="true"], [role="radio"][data-checked="true"], input[type="radio"]:checked',

  // ── Checkboxes ─────────────────────────────────────────────────────────────
  // Google uses role="checkbox" on custom elements; aria-checked="true" is the signal.
  CHECKBOX_OPTION:         '[role="checkbox"]',
  CHECKBOX_OPTION_CHECKED: '[role="checkbox"][aria-checked="true"], [role="checkbox"][data-checked="true"], input[type="checkbox"]:checked',

  // ── Dropdown ───────────────────────────────────────────────────────────────
  // The collapsed control that the user clicks to open the dropdown list.
  DROPDOWN_LISTBOX: '[role="listbox"]',

  // The individual options inside a dropdown.
  DROPDOWN_OPTION: '[role="option"]',

  // The selected option carries aria-selected="true" per ARIA spec.
  DROPDOWN_OPTION_SELECTED: '[role="option"][aria-selected="true"]',

  // ── Date and time inputs ────────────────────────────────────────────────────
  DATE_INPUT: 'input[type="date"]',
  TIME_INPUT: 'input[type="time"]',

  // ── Generic fallback inputs ─────────────────────────────────────────────────
  ANY_INPUT:    'input:not([type="hidden"])',
  ANY_TEXTAREA: 'textarea',

  // ── "Other" free-text field inside radio / checkbox groups ─────────────────
  OTHER_INPUT: 'input[type="text"][aria-label]',

  // ── Submit / navigation footer ──────────────────────────────────────────────
  SUBMIT_BUTTON: '[role="button"][jsname]',
  FOOTER_NAVIGATION: '[role="navigation"]',
};
