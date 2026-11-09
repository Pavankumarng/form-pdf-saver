/**
 * extractor.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads the live DOM of a Google Forms RESPONDENT page (/viewform) and returns
 * a structured snapshot of the current page's questions and answers.
 *
 * PUBLIC API (attached to window.FormPDF):
 *
 *   window.FormPDF.getFormTitle()   → string
 *     Returns the form's title text.
 *
 *   window.FormPDF.extractCurrentPage()  → Question[]
 *     Returns all questions visible on the current page.
 *
 *   Question {
 *     id:     string,           // stable key: slugified title + "_" + index
 *     title:  string,           // the question prompt shown to the respondent
 *     type:   QuestionType,     // see TYPE enum below
 *     answer: string | string[] // respondent's current input; "" / [] if blank
 *   }
 *
 *   QuestionType (string enum):
 *     "short_text" | "paragraph" | "multiple_choice" | "checkboxes" |
 *     "dropdown"   | "linear_scale" | "date" | "time" | "unknown"
 *
 * DEPENDENCIES (globals loaded before this script):
 *   window.FormPDF.SELECTORS  — from src/selectors.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function attachExtractor() {
  "use strict";

  window.FormPDF = window.FormPDF || {};

  const S = () => window.FormPDF.SELECTORS;

  // ── Question type enum ──────────────────────────────────────────────────────

  const TYPE = {
    SHORT_TEXT:      "short_text",
    PARAGRAPH:       "paragraph",
    MULTIPLE_CHOICE: "multiple_choice",
    CHECKBOXES:      "checkboxes",
    DROPDOWN:        "dropdown",
    LINEAR_SCALE:    "linear_scale",
    DATE:            "date",
    TIME:            "time",
    UNKNOWN:         "unknown",
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Returns true if the element contains an interactive input control.
   */
  function hasInputControl(el) {
    // Check ARIA roles first (most reliable for Google Forms custom elements)
    if (el.querySelector('[role="radio"], [role="checkbox"], [role="listbox"]')) return true;
    // Native inputs / textarea
    if (el.querySelector('input:not([type="hidden"]), textarea')) return true;
    return false;
  }

  /**
   * Extracts the question title from a container element, stripping trailing *.
   */
  function extractQuestionTitle(container) {
    try {
      const heading = container.querySelector(S().QUESTION_HEADING);
      if (heading) {
        // Strip trailing required asterisk (*) which Google appends visually
        const text = heading.textContent.trim().replace(/\s*\*\s*$/, "");
        if (text) return text;
      }

      // Fallback: depth-first walk looking for the first meaningful text node
      const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            return node.textContent.trim()
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_SKIP;
          },
        }
      );
      const firstText = walker.nextNode();
      return firstText ? firstText.textContent.trim().replace(/\s*\*\s*$/, "") : "";
    } catch (err) {
      console.warn("[FormPDF] extractQuestionTitle error:", err);
      return "";
    }
  }

  function makeQuestionId(title, index) {
    const slug = title
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 60);
    return `${slug || "question"}_${index}`;
  }

  /**
   * Reads the human-readable label of an ARIA radio or checkbox option element.
   * Priority order: data-answer-value → data-value → aria-label → aria-labelledby
   * → closest option row text → element text content.
   */
  function getOptionLabel(optionEl) {
    try {
      // 1. data-answer-value (most specific — Google Forms internal value)
      const dataAnswerVal = optionEl.getAttribute("data-answer-value");
      if (dataAnswerVal && dataAnswerVal.trim() && dataAnswerVal !== "__other_option__") {
        return dataAnswerVal.trim();
      }

      // 2. data-value attribute directly on the option
      const dataVal = optionEl.getAttribute("data-value");
      if (dataVal && dataVal.trim()) return dataVal.trim();

      // 3. aria-label attribute
      const ariaLabel = optionEl.getAttribute("aria-label");
      if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

      // 4. aria-labelledby reference
      const labelledById = optionEl.getAttribute("aria-labelledby");
      if (labelledById) {
        const label = labelledById
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
          .join(" ")
          .trim();
        if (label) return label;
      }

      // 5. Option row / container text (closest option wrapper)
      // Use [role="listitem"] but only the IMMEDIATE option wrapper, not the question card
      const optionRow = optionEl.closest('label, [data-value]') ||
                        (optionEl.parentElement ? optionEl.parentElement.closest('[role="listitem"]') : null);
      if (optionRow) {
        const rowDataVal = optionRow.getAttribute("data-value");
        if (rowDataVal && rowDataVal.trim()) return rowDataVal.trim();

        const clone = optionRow.cloneNode(true);
        // Remove text inputs so custom "Other" typed text doesn't pollute the option label
        clone.querySelectorAll('input[type="text"], input[type="email"], textarea').forEach((inp) => inp.remove());
        const rowText = (clone.innerText || clone.textContent || "").trim();
        if (rowText) return rowText;
      }

      // 6. Element textContent / innerText fallback
      return (optionEl.innerText || optionEl.textContent || "").trim();
    } catch (err) {
      console.warn("[FormPDF] getOptionLabel error:", err);
      return "";
    }
  }

  /**
   * Returns true if a radio or checkbox element represents the "Other" option.
   */
  function isOtherOption(optionEl) {
    const dataAnswerVal = optionEl.getAttribute("data-answer-value");
    if (dataAnswerVal === "__other_option__") return true;
    if (optionEl.hasAttribute("data-other-checkbox") || optionEl.hasAttribute("data-other-radio")) return true;
    // Some Google Forms variants mark the other option via a sibling input
    const parent = optionEl.parentElement;
    if (parent && parent.querySelector('input[type="text"][data-initial-value=""]')) {
      // Check if this looks like the "Other" row (the row has very short label text)
      const label = getOptionLabel(optionEl);
      if (/^other[:\s]?$/i.test(label)) return true;
    }
    return false;
  }

  /**
   * Detects the question type for a given container element.
   *
   * PRIORITY ORDER (critical — do NOT reorder):
   *   1. Checkboxes  — [role="checkbox"] present
   *   2. Radio/MC    — [role="radio"] present
   *   3. Dropdown    — [role="listbox"] present
   *   4. Date        — input[type="date"] OR split date fields (Year/Month/Day)
   *   5. Time        — input[type="time"] OR split time fields (Hour/Minute)
   *   6. Paragraph   — textarea
   *   7. Short Text  — input[type="text/email/url/number"] — LAST (catches "Other" inputs)
   */
  function detectType(container) {
    try {
      // 1. Checkboxes (MUST come before radio)
      if (container.querySelector(S().CHECKBOX_OPTION)) return TYPE.CHECKBOXES;

      // 2. Radio → Multiple Choice or Linear Scale
      const radioOptions = container.querySelectorAll(S().RADIO_OPTION);
      if (radioOptions.length > 0) {
        const allNumeric = radioOptions.length >= 3 && [...radioOptions].every((opt) => {
          const label = getOptionLabel(opt).trim();
          return label !== "" && !isNaN(Number(label));
        });
        return allNumeric ? TYPE.LINEAR_SCALE : TYPE.MULTIPLE_CHOICE;
      }

      // 3. Dropdown
      if (container.querySelector(S().DROPDOWN_LISTBOX)) return TYPE.DROPDOWN;

      // 4. Date — native input OR split year/month/day inputs
      if (container.querySelector(S().DATE_INPUT)) return TYPE.DATE;
      if (
        container.querySelector('input[aria-label*="Year" i], input[aria-label*="Month" i], input[aria-label*="Day" i]')
      ) return TYPE.DATE;

      // 5. Time — native input OR split hour/minute inputs
      if (container.querySelector(S().TIME_INPUT)) return TYPE.TIME;
      if (
        container.querySelector('input[aria-label*="Hour" i], input[aria-label*="Minute" i]')
      ) return TYPE.TIME;

      // 6. Paragraph (textarea)
      if (container.querySelector(S().PARAGRAPH_INPUT)) return TYPE.PARAGRAPH;

      // 7. Short text — LAST so "Other:" inputs in MC/Checkbox don't trigger this
      if (
        container.querySelector(S().SHORT_TEXT_INPUT) ||
        container.querySelector(S().EMAIL_INPUT) ||
        container.querySelector(S().NUMBER_INPUT) ||
        container.querySelector(S().URL_INPUT)
      ) {
        return TYPE.SHORT_TEXT;
      }

      return TYPE.UNKNOWN;
    } catch (err) {
      console.warn("[FormPDF] detectType error:", err);
      return TYPE.UNKNOWN;
    }
  }

  // ── Per-type answer extractors ───────────────────────────────────────────────

  function extractShortText(container) {
    const sel = [
      S().SHORT_TEXT_INPUT,
      S().EMAIL_INPUT,
      S().NUMBER_INPUT,
      S().URL_INPUT,
    ].join(", ");
    // Exclude inputs that are "Other:" text boxes inside radio/checkbox groups
    const inputs = container.querySelectorAll(sel);
    for (const input of inputs) {
      // Skip inputs that are siblings to aria-role radio/checkbox (the "Other" text box)
      const parentRow = input.closest('[role="listitem"], label');
      if (parentRow) {
        const hasOptionRole = parentRow.querySelector('[role="radio"], [role="checkbox"]');
        if (hasOptionRole) continue;
      }
      return input.value.trim();
    }
    // If all inputs are inside option rows, just return the first non-empty value
    const firstInput = container.querySelector(sel);
    return firstInput ? firstInput.value.trim() : "";
  }

  function extractParagraph(container) {
    const ta = container.querySelector(S().PARAGRAPH_INPUT);
    return ta ? ta.value.trim() : "";
  }

  function extractRadio(container) {
    // Try selectors.js checked selector first
    let checked = container.querySelector(S().RADIO_OPTION_CHECKED);
    if (!checked) {
      checked = container.querySelector('[role="radio"][aria-checked="true"]');
    }
    if (!checked) {
      // Native radio fallback
      checked = container.querySelector('input[type="radio"]:checked');
    }
    if (!checked) return "";

    // Check if this is the "Other" option
    if (isOtherOption(checked)) {
      const otherInput = container.querySelector(S().OTHER_INPUT) ||
                         container.querySelector('input[type="text"]');
      if (otherInput && otherInput.value.trim()) {
        return "Other: " + otherInput.value.trim();
      }
      return "Other";
    }

    return getOptionLabel(checked);
  }

  function extractCheckboxes(container) {
    let checkedOptions = container.querySelectorAll(S().CHECKBOX_OPTION_CHECKED);
    if (!checkedOptions || checkedOptions.length === 0) {
      checkedOptions = container.querySelectorAll('[role="checkbox"][aria-checked="true"]');
    }
    // Native checkbox fallback
    if (!checkedOptions || checkedOptions.length === 0) {
      checkedOptions = container.querySelectorAll('input[type="checkbox"]:checked');
    }

    const answers = [];

    for (const opt of checkedOptions) {
      if (isOtherOption(opt)) {
        const otherInput = container.querySelector(S().OTHER_INPUT) ||
                           container.querySelector('input[type="text"]');
        const customText = otherInput ? otherInput.value.trim() : "";
        answers.push(customText ? "Other: " + customText : "Other");
      } else {
        const label = getOptionLabel(opt);
        if (label) answers.push(label);
      }
    }

    return answers;
  }

  function extractDropdown(container) {
    const selectedOption = container.querySelector(S().DROPDOWN_OPTION_SELECTED);
    if (selectedOption) {
      const text = selectedOption.textContent.trim();
      if (text && !/^choose$/i.test(text) && !/^select$/i.test(text)) {
        return text;
      }
    }

    // Fallback: read displayed value from the listbox trigger
    const listbox = container.querySelector(S().DROPDOWN_LISTBOX);
    if (listbox) {
      const triggerText = listbox.textContent.trim();
      if (
        triggerText &&
        !/^choose$/i.test(triggerText) &&
        !/^select$/i.test(triggerText)
      ) {
        return triggerText;
      }
    }

    return "";
  }

  /**
   * Extracts date answer, handling both native date input and split Year/Month/Day inputs.
   */
  function extractDate(container) {
    const nativeInput = container.querySelector(S().DATE_INPUT);
    if (nativeInput && nativeInput.value.trim()) return nativeInput.value.trim();

    // Split date fields (Google Forms sometimes uses separate inputs)
    const yearInput  = container.querySelector('input[aria-label*="Year" i]');
    const monthInput = container.querySelector('input[aria-label*="Month" i]');
    const dayInput   = container.querySelector('input[aria-label*="Day" i]');

    if (yearInput || monthInput || dayInput) {
      const y = yearInput  ? yearInput.value.trim()  : "";
      const m = monthInput ? monthInput.value.trim() : "";
      const d = dayInput   ? dayInput.value.trim()   : "";
      const parts = [m, d, y].filter(Boolean);
      return parts.length > 0 ? parts.join("/") : "";
    }

    return nativeInput ? nativeInput.value.trim() : "";
  }

  /**
   * Extracts time answer, handling both native time input and split Hour/Minute inputs.
   */
  function extractTime(container) {
    const nativeInput = container.querySelector(S().TIME_INPUT);
    if (nativeInput && nativeInput.value.trim()) return nativeInput.value.trim();

    // Split time fields (Google Forms Hour/Minute inputs)
    const hourInput   = container.querySelector('input[aria-label*="Hour" i]');
    const minInput    = container.querySelector('input[aria-label*="Minute" i]');
    const ampmSelect  = container.querySelector('select[aria-label*="AM" i], select[aria-label*="PM" i]') ||
                        container.querySelector('select');

    if (hourInput && minInput) {
      const h = hourInput.value.trim();
      const m = (minInput.value.trim() || "0").padStart(2, "0");
      const ampm = ampmSelect ? ampmSelect.value.trim() : "";
      if (h) return h + ":" + m + (ampm ? " " + ampm : "");
    }

    return nativeInput ? nativeInput.value.trim() : "";
  }

  function extractUnknown(container) {
    const input = container.querySelector(S().ANY_INPUT);
    if (input && input.value && input.value.trim()) {
      return input.value.trim();
    }

    const ta = container.querySelector(S().ANY_TEXTAREA);
    if (ta && ta.value && ta.value.trim()) {
      return ta.value.trim();
    }

    const ariaChecked = container.querySelector('[aria-checked="true"]');
    if (ariaChecked) {
      const label = getOptionLabel(ariaChecked);
      if (label) return label;
    }

    return "";
  }

  function extractAnswer(container, type) {
    try {
      switch (type) {
        case TYPE.SHORT_TEXT:      return extractShortText(container);
        case TYPE.PARAGRAPH:       return extractParagraph(container);
        case TYPE.MULTIPLE_CHOICE: return extractRadio(container);
        case TYPE.LINEAR_SCALE:    return extractRadio(container);
        case TYPE.CHECKBOXES:      return extractCheckboxes(container);
        case TYPE.DROPDOWN:        return extractDropdown(container);
        case TYPE.DATE:            return extractDate(container);
        case TYPE.TIME:            return extractTime(container);
        case TYPE.UNKNOWN:         return extractUnknown(container);
        default:                   return extractUnknown(container);
      }
    } catch (err) {
      console.warn("[FormPDF] extractAnswer error (type=" + type + "):", err);
      return type === TYPE.CHECKBOXES ? [] : "";
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  window.FormPDF.getFormTitle = function getFormTitle() {
    try {
      const h1 = document.querySelector(S().FORM_TITLE);
      if (h1) {
        const text = h1.textContent.trim().replace(/\s*\*\s*$/, "");
        if (text) return text;
      }

      const docTitle = document.title || "";
      return docTitle.replace(/\s*-\s*Google Forms\s*$/i, "").trim() || "Untitled Form";
    } catch (err) {
      console.warn("[FormPDF] getFormTitle error:", err);
      return "Untitled Form";
    }
  };

  /**
   * Extracts all questions visible on the CURRENT page of the form.
   *
   * Filtering rules (applied in order):
   *   1. Skip any [role="listitem"] that has an ancestor [role="listitem"]
   *      → eliminates checkbox/radio option rows that Google marks as listitems
   *   2. Skip containers without a [role="heading"] child
   *      → eliminates description blocks, images, section dividers
   *   3. Skip containers with no interactive input control
   *      → eliminates purely informational headings
   */
  window.FormPDF.extractCurrentPage = function extractCurrentPage() {
    const results = [];

    try {
      const allListItems = document.querySelectorAll(S().QUESTION_CONTAINER);
      let questionIndex = 0;

      for (const container of allListItems) {
        try {
          // Guard 1: reject nested listitems (option rows inside question card)
          // Walk the full ancestor chain, not just immediate parent
          if (container.parentElement && container.parentElement.closest(S().QUESTION_CONTAINER)) {
            continue;
          }

          // Guard 2: require a question heading ([role="heading"])
          if (!container.querySelector(S().QUESTION_HEADING)) {
            // Allow [data-params] as an alternative signal (older Google Forms)
            if (!container.querySelector("[data-params]")) {
              continue;
            }
          }

          // Guard 3: skip blocks that contain no interactive input
          if (!hasInputControl(container)) {
            continue;
          }

          const title  = extractQuestionTitle(container);
          const type   = detectType(container);
          const answer = extractAnswer(container, type);
          const id     = makeQuestionId(title, questionIndex);

          results.push({ id, title, type, answer });
          questionIndex++;
        } catch (innerErr) {
          console.warn("[FormPDF] Error processing question block:", innerErr, container);
          results.push({
            id:     makeQuestionId("", questionIndex),
            title:  "",
            type:   TYPE.UNKNOWN,
            answer: "",
          });
          questionIndex++;
        }
      }
    } catch (outerErr) {
      console.error("[FormPDF] extractCurrentPage fatal error:", outerErr);
    }

    return results;
  };

})(); // end IIFE
