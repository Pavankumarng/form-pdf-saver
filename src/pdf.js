/**
 * pdf.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Converts accumulated form answers into a downloadable PDF using the locally
 * bundled jsPDF library. Everything runs client-side; no data leaves the browser.
 *
 * PUBLIC API  (attached to window.FormPDF)
 * ──────────────────────────────────────────────────────────────
 *   window.FormPDF.generatePdf({ formTitle, entries })  → void
 *
 *   Parameters:
 *     formTitle {string}   — the form's heading text
 *     entries   {Array}    — ordered Question array from window.FormPDF.getAll()
 *                           Each entry: { id, title, type, answer }
 *                           answer is a string OR string[] (checkboxes).
 *
 * PDF LAYOUT
 * ──────────
 *   • A4 portrait, millimetre units (jsPDF mm mode is simplest for A4).
 *   • Page margin: 20 mm on all sides.
 *   • Form title: bold 18 pt, underlined, at the top.
 *   • Each question: bold 11 pt label, then regular 10 pt answer text.
 *   • Checkbox answers are joined as "• item1  • item2  …".
 *   • Unanswered questions show "(No answer)" in italic grey.
 *   • Long text is word-wrapped with doc.splitTextToSize().
 *   • A new page is added automatically when content nears the bottom margin.
 *   • A thin separator rule is drawn between questions.
 *   • Filename: slugified form title + ".pdf".
 *
 * DEPENDENCIES  (globals loaded before this script)
 * ─────────────────────────────────────────────────
 *   window.jspdf.jsPDF  — from lib/jspdf.umd.min.js
 *
 * CONSTRAINTS
 * ───────────
 *   • No ES module syntax (no import / export).
 *   • No network calls, no eval, no remote fonts.
 *   • Errors logged with "[FormPDF]" prefix.
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function attachPdf() {
  "use strict";

  window.FormPDF = window.FormPDF || {};

  // ── Layout constants (millimetres unless noted) ───────────────────────────────

  const MARGIN          = 20;     // page margin mm (all sides)
  const PAGE_W          = 210;    // A4 width  mm
  const PAGE_H          = 297;    // A4 height mm
  const CONTENT_W       = PAGE_W - MARGIN * 2;   // usable text width mm
  const BOTTOM_LIMIT    = PAGE_H - MARGIN;        // y at which we add a new page

  const TITLE_SIZE      = 18;   // pt — form title
  const QUESTION_SIZE   = 11;   // pt — question label
  const ANSWER_SIZE     = 10;   // pt — answer text
  const LINE_GAP        = 1.5;  // mm — extra leading between wrapped lines
  const SECTION_GAP     = 6;    // mm — space between questions
  const RULE_GAP        = 3;    // mm — space above/below separator rule

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function toFilename(title) {
    return (title || "form-answers")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-]/g, "")
      .replace(/-+/g, "-")
      .slice(0, 80) || "form-answers";
  }

  function formatAnswer(answer) {
    if (Array.isArray(answer)) {
      const items = answer.map((s) => String(s).trim()).filter(Boolean);
      return items.length ? items.map((s) => "\u2022 " + s).join("   ") : null;
    }
    const s = String(answer == null ? "" : answer).trim();
    return s || null;
  }

  function wrapText(doc, text, maxWidth) {
    return doc.splitTextToSize(text, maxWidth);
  }

  function advance(doc, cursor, advanceMm) {
    cursor.y += advanceMm;
    if (cursor.y > BOTTOM_LIMIT) {
      doc.addPage();
      cursor.y = MARGIN;
    }
  }

  function printLines(doc, cursor, lines, fontSize) {
    const lineHeightMm = fontSize * 0.3528 * doc.getLineHeightFactor() + LINE_GAP;

    for (const line of lines) {
      if (cursor.y + lineHeightMm > BOTTOM_LIMIT) {
        doc.addPage();
        cursor.y = MARGIN;
      }
      doc.text(line, MARGIN, cursor.y);
      cursor.y += lineHeightMm;
    }
  }

  /**
   * Triggers file download in the browser.
   * Priority: Blob + attached <a> click (bypasses Chromium sandbox restrictions
   * on detached elements) -> doc.save() fallback.
   */
  function downloadPdfDocument(doc, filename) {
    let triggered = false;

    try {
      if (typeof doc.output === "function") {
        const blob = doc.output("blob");
        if (blob && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
          const blobUrl = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.style.cssText = "display:none;";
          link.href = blobUrl;
          link.download = filename;
          (document.body || document.documentElement).appendChild(link);
          link.click();
          triggered = true;

          setTimeout(() => {
            try {
              link.remove();
              URL.revokeObjectURL(blobUrl);
            } catch (_) {}
          }, 2000);
        }
      }
    } catch (blobErr) {
      console.warn("[FormPDF] Blob download failed, falling back to doc.save():", blobErr);
    }

    if (!triggered) {
      doc.save(filename);
    }
  }

  // ── Main public function ──────────────────────────────────────────────────────

  window.FormPDF.generatePdf = function generatePdf(opts) {
    try {
      const jsPDFCtor =
        (window.jspdf && window.jspdf.jsPDF) ||
        (window.jsPDF)                        ||
        (window.jspdf && window.jspdf.default) ||
        null;

      if (!jsPDFCtor) {
        console.error(
          "[FormPDF] jsPDF not found. Make sure lib/jspdf.umd.min.js is bundled."
        );
        if (window.FormPDF.showToast) {
          window.FormPDF.showToast(
            "PDF library not loaded. See README for setup instructions."
          );
        }
        return;
      }

      const formTitle = (opts && typeof opts.formTitle === "string")
        ? opts.formTitle.trim() || "Untitled Form"
        : "Untitled Form";

      const entries = (opts && Array.isArray(opts.entries))
        ? opts.entries
        : [];

      // ── 1. Create document ──────────────────────────────────────────────────
      const doc = new jsPDFCtor({
        orientation: "portrait",
        unit:        "mm",
        format:      "a4",
      });

      doc.setFont("helvetica");

      const cursor = { y: MARGIN };

      // ── 2. Form title ───────────────────────────────────────────────────────
      doc.setFontSize(TITLE_SIZE);
      doc.setFont("helvetica", "bold");

      const titleLines = wrapText(doc, formTitle, CONTENT_W);
      printLines(doc, cursor, titleLines, TITLE_SIZE);

      const ruleY = cursor.y + 0.5;
      doc.setDrawColor(100, 100, 100);
      doc.setLineWidth(0.3);
      doc.line(MARGIN, ruleY, PAGE_W - MARGIN, ruleY);
      cursor.y = ruleY + RULE_GAP + 2;

      // ── 3. Questions ────────────────────────────────────────────────────────
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];

        if (i > 0) {
          advance(doc, cursor, RULE_GAP);
          doc.setDrawColor(200, 200, 200);
          doc.setLineWidth(0.2);
          doc.line(MARGIN, cursor.y, PAGE_W - MARGIN, cursor.y);
          advance(doc, cursor, RULE_GAP);
        }

        const questionText = (typeof entry.title === "string" && entry.title.trim())
          ? entry.title.trim()
          : "(Untitled question)";

        doc.setFontSize(QUESTION_SIZE);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(30, 30, 30);

        const questionLines = wrapText(doc, (i + 1) + ". " + questionText, CONTENT_W);
        printLines(doc, cursor, questionLines, QUESTION_SIZE);

        advance(doc, cursor, 1.5);

        // Answer text
        doc.setFontSize(ANSWER_SIZE);

        const formatted = formatAnswer(entry.answer);

        if (formatted) {
          doc.setFont("helvetica", "normal");
          doc.setTextColor(40, 40, 40);
          const answerLines = wrapText(doc, formatted, CONTENT_W - 4);
          const lineHeightMm = ANSWER_SIZE * 0.3528 * doc.getLineHeightFactor() + LINE_GAP;
          for (const line of answerLines) {
            if (cursor.y + lineHeightMm > BOTTOM_LIMIT) {
              doc.addPage();
              cursor.y = MARGIN;
            }
            doc.text(line, MARGIN + 4, cursor.y);
            cursor.y += lineHeightMm;
          }
        } else {
          doc.setFont("helvetica", "italic");
          doc.setTextColor(140, 140, 140);
          doc.text("(No answer)", MARGIN + 4, cursor.y);
          cursor.y += ANSWER_SIZE * 0.3528 * doc.getLineHeightFactor() + LINE_GAP;
        }

        advance(doc, cursor, SECTION_GAP * 0.4);
      }

      // ── 4. Footer — page numbers ────────────────────────────────────────────
      const totalPages = doc.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(160, 160, 160);
        doc.text(
          "Page " + p + " of " + totalPages,
          PAGE_W - MARGIN,
          PAGE_H - 10,
          { align: "right" }
        );
        doc.setTextColor(0, 0, 0);
      }

      // ── 5. Trigger download ──────────────────────────────────────────────────
      const filename = toFilename(formTitle) + ".pdf";
      downloadPdfDocument(doc, filename);

      console.log("[FormPDF] PDF saved:", filename);

    } catch (err) {
      console.error("[FormPDF] generatePdf error:", err);
      try {
        if (window.FormPDF.showToast) {
          window.FormPDF.showToast("PDF generation failed — see browser console.");
        }
      } catch (_) {}
    }
  };

})(); // end IIFE
