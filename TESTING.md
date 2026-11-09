# Manual Testing Checklist — Form PDF Saver

Use this checklist after every code change and before any release.  
Test in both **Microsoft Edge** and **Google Chrome** with the extension loaded unpacked.

---

## Setup

- [ ] `lib/jspdf.umd.min.js` is present in the project folder.
- [ ] Extension loaded via `edge://extensions` or `chrome://extensions` → **Load unpacked**.
- [ ] Extension is **enabled** and shows no errors on the extensions page.
- [ ] DevTools console (F12) is open during all tests to catch `[FormPDF]` warnings/errors.

---

## 1. Button Injection

| # | Step | Expected |
|---|---|---|
| 1.1 | Open a Google Form respondent URL (`/viewform`). | Floating blue pill button **"Save answers as PDF"** appears in the bottom-right corner. |
| 1.2 | Open the form editor URL (`/edit`). | **No button** is injected. |
| 1.3 | Open a Google Doc or any non-Forms page. | **No button** is injected. |
| 1.4 | Keyboard-navigate to the button (Tab key). | Button receives a visible focus ring. |
| 1.5 | Hover the mouse over the button. | Button darkens slightly. |

---

## 2. Question Type Coverage

Create a test form with **one of each question type** and fill every field before saving.

| # | Question type | Input | Expected in PDF |
|---|---|---|---|
| 2.1 | **Short answer** | "Alice" | "Alice" |
| 2.2 | **Paragraph** | Multi-line text | Full text, word-wrapped if long |
| 2.3 | **Multiple choice** | Select one option | The selected option's label |
| 2.4 | **Multiple choice — Other** | Select "Other" and type "My answer" | "Other: My answer" |
| 2.5 | **Checkboxes** | Check 2–3 options | Bullet list "• A   • B   • C" |
| 2.6 | **Checkboxes — Other** | Check "Other" + type text | "Other: custom text" in list |
| 2.7 | **Dropdown** | Select a non-placeholder option | The selected option text |
| 2.8 | **Dropdown — unselected** | Leave on "Choose" / "Select" | "(No answer)" |
| 2.9 | **Linear scale** | Click scale value 4 | "4" (or the numeric label) |
| 2.10 | **Date** | Pick a date | ISO format YYYY-MM-DD |
| 2.11 | **Time** | Pick a time | HH:MM |
| 2.12 | **File upload** | _(skip — not supported in v1)_ | Documented limitation |

---

## 3. Empty / Required Fields

| # | Step | Expected |
|---|---|---|
| 3.1 | Leave **all** fields empty, click button. | Toast: "No answers found — try filling in at least one field first." No PDF download. |
| 3.2 | Fill one field, leave others empty. | PDF is generated; empty questions show "(No answer)". |
| 3.3 | Fill a required field incorrectly (e.g. invalid email format). | Extension still reads whatever value is in the input; validation is Google's responsibility. |

---

## 4. Multi-Section Form

Create or find a form with **at least 3 sections**.

| # | Step | Expected |
|---|---|---|
| 4.1 | Fill section 1, click **Next**. | No PDF yet; console shows no errors. |
| 4.2 | Fill section 2, click **Next**. | Still no PDF. |
| 4.3 | On section 3, click **"Save answers as PDF"**. | PDF contains questions from **all 3 sections** in order. |
| 4.4 | On section 3, click **Submit**. | Console shows `[FormPDF] /viewform initialised.` or submit snapshot; no errors. |
| 4.5 | On `/formResponse` confirmation page. | Button **"Download PDF of what I submitted"** appears. |
| 4.6 | Click the confirmation-page button. | PDF downloaded; button changes to **"PDF downloaded ✓"**. |
| 4.7 | Click the button again. | Toast: "PDF was already downloaded." No second download. |

---

## 5. Long Answer — Page Overflow

| # | Step | Expected |
|---|---|---|
| 5.1 | Enter a paragraph answer longer than one PDF page (paste ~3000+ chars). | PDF has **multiple pages**; text does not overflow off the page. |
| 5.2 | Have many questions so the content spans 3+ pages. | Each page has a **"Page X of N"** footer. |

---

## 6. Non-Latin / Special Characters

> **v1 known limitation:** jsPDF's built-in Helvetica font supports Latin-1 (Western European) characters. Characters outside that range may render as boxes or be omitted.

| # | Step | Expected |
|---|---|---|
| 6.1 | Type a French/German answer: "Ça va très bien, über alles." | Characters render correctly in the PDF. |
| 6.2 | Type an answer with emoji: "Great 😊". | Emoji may not render (known limitation). No crash. |
| 6.3 | Type a Cyrillic/Arabic/CJK answer. | May not render correctly (known v1 limitation). Extension **does not crash**. |
| 6.4 | Form title contains special chars: "Formulaire & Enquête". | Title appears correctly in the PDF. |

---

## 7. Confirmation Page (`/formResponse`)

| # | Step | Expected |
|---|---|---|
| 7.1 | Submit the form normally. | Lands on `/formResponse`; download button appears. |
| 7.2 | Open `/formResponse` directly (paste URL in a new tab). | **No button** (no saved session data). No errors. |
| 7.3 | Submit, download PDF, then close the tab and re-open `/formResponse`. | **No button** (sessionStorage is per-tab). |

---

## 8. PDF Content Verification

Open the downloaded PDF and verify:

- [ ] Form title appears at the top, bold and underlined.
- [ ] Questions are numbered (1, 2, 3 …).
- [ ] Each answer appears directly below its question, slightly indented.
- [ ] Unanswered questions show "(No answer)" in grey italic.
- [ ] Questions from all sections appear in the correct encounter order.
- [ ] File is named `<form-title>.pdf` (slugified).

---

## 9. Privacy Checks

- [ ] Open DevTools → Network tab; **no outbound requests** occur at any point.
- [ ] Check Application → Session Storage: data appears only under `formpdf:…` key.
- [ ] Check Application → Local Storage: **nothing** written by the extension.
- [ ] No `chrome.storage` or background page activity in the extension details.

---

## 10. Error Handling

| # | Step | Expected |
|---|---|---|
| 10.1 | Load the extension without `lib/jspdf.umd.min.js` present. | Toast: "PDF library not loaded…"; no crash. |
| 10.2 | Click the button while `extractCurrentPage` throws (simulate by patching in DevTools). | Error caught; toast shown; button re-enabled. |
| 10.3 | Disable sessionStorage via DevTools (Incognito + block storage). | Extension still works; console shows `[FormPDF] sessionStorage … failed`. No crash. |
