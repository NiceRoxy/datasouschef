# DataSousChef — Guided Interview Script v1.0

**Purpose:** Replace the per-column questionnaire with a branching interview that collects a complete, unambiguous cleaning brief. Every answer writes directly into a field of the structured spec (Pydantic contract); the coder LLM receives the assembled spec, never free prose.

**Status:** Draft for Helen's review, then handover to Antigravity.
**Out of scope this stage:** cross-dataset linkage; full cross-column logic rules (except date ordering and conditional recodes, which are retained because real cleaning requires them).

---

## Design principles (for Antigravity)

1. **Upload-first.** If the user uploads a dummy/sample file, auto-detect everything detectable (headers, inferred types, distinct values, missing counts) and convert those questions into *confirmations* with pre-filled answers. Only ask what the file cannot answer. This is the main efficiency lever for wide datasets.
2. **Every question has an action.** No question is asked unless a specific script behaviour depends on the answer.
3. **Structured answers over free text.** Selects, tables, and mappings wherever possible. Free text only as an "Other" escape hatch.
4. **Column-major grouping.** After typing (Section C), all remaining questions for one column are asked together before moving to the next column, so the user thinks about each column once.
5. **No silent fixes.** Where a rule can be violated (duplicates, unparseable dates, out-of-range numbers, unmapped categories), the default action is *report*, and any destructive action is an explicit user choice.
6. **Final review before generation.** The assembled brief is shown in plain language for approval. Approval, not upload, triggers script generation.

**Notation:**
`[single]` one choice · `[multi]` several choices · `[text]` short free text · `[number]` numeric input · `[table]` structured rows · `[file]` file upload
`IF …` = branch condition; indented questions appear only when the condition is met.
`(pre-fill)` = answered automatically when a sample file was uploaded; shown to the user for confirmation only.

---

## Section 0 — Session setup

**Q0.1** How many separate data files do you want to prepare? `[number 1–5]`
→ Sections A–H repeat for each file. Linkage between files is not offered at this stage (placeholder for a later release).

---

## Section A — About your file

**QA.1** What is the exact file name, including the ending (e.g. `student_register.csv`)? `[text]`
**QA.2** What format is the file? `[single: CSV / Excel (.xlsx) / Excel (.xls) / Tab-separated / Other]`
> IF *Excel* → **QA.2a** Which sheet holds the data? `[text — default: first sheet]`
**QA.3** Does the first row contain the column headings? `[single: Yes / No / Not sure]` (pre-fill)
**QA.4** Roughly how many records? `[single: under 1,000 / 1,000–10,000 / 10,000–100,000 / over 100,000 / not sure]`
→ Used only for performance choices (e.g. chunked reading); never blocks the user.
**QA.5** Text encoding, if you know it. `[single: UTF-8 / Windows-1252 (common for UK Excel exports) / Not sure]`
→ IF *Not sure*: script tries UTF-8, falls back to Windows-1252, and reports which succeeded.

---

## Section B — Telling us about your columns

**QB.1** Choose how to tell us about your columns:

- **Route 1 (recommended): upload a dummy or sample file.** `[file]`
  A few rows of made-up data with the real column headings is enough. Reminder shown to user: *use dummy values, not real records.*
  → Auto-detects: headings, inferred type per column, example values, distinct values, missing-value counts. These pre-fill Sections C and D.
  → **Re-upload behaviour (important):** merge by column name — never clear answers the user has already given. New columns are added; removed columns prompt "keep or discard the rules for X?"
- **Route 2 (fallback): type or paste your column headings, one per line.** `[text, multiline]`
  One per line avoids the comma-in-heading problem. Validation: spaces are auto-trimmed (see Default hygiene rules); warn on duplicate headings.

**QB.2** Which of these columns do you want us to work on? `[multi — default: all]`
→ Unselected columns are carried through to the cleaned file **unchanged**. (This replaces the old "which columns are free text?" question — anything the user doesn't act on is simply left alone.)

---

## Default hygiene rules (always applied — shown as information, never asked)

These run on every dataset without any user action, and every change is counted in the report:

1. **Column headings** are trimmed of leading/trailing spaces and repeated internal spaces are collapsed **at file-read time, before any rules are matched to columns**. This prevents an invisible space in a heading from breaking the generated script (KeyError). The spec stores the cleaned heading; the report lists any heading that was changed.
2. **Every cell value** in every column is trimmed of leading/trailing spaces.
3. **Repeated internal spaces are collapsed** in every column *except* those typed "Leave as text" — for free-text content this could alter meaning, so there it is an opt-in (Section F).

→ For Antigravity: the same trimming must be applied consistently in the app's own parser (Route 1 upload) and in the generated script, so the column names the user answered about always match the names the script sees.

---

## Section C — What kind of data is in each column?

**QC.0** For each selected column, pick the best description: `[single per column: ID / Date / Number / Category / Leave as text]` (pre-fill from sample)

The follow-ups below then run **per column**, grouped so the user finishes one column before starting the next.

### C-ID — for each ID column

**QC.1** Should every record have a *different* value in this column? `[single: Yes, must be unique / No, repeats are expected / Not sure]`
> IF *must be unique* → **QC.1a** If duplicates are found, what should the script do? `[single: Just count and list them in the report / Remove duplicate records]`
>> IF *Remove* → **QC.1b** Which record should be kept? `[single: First occurrence / Last occurrence / The one with the latest date in… → pick a date column]`
**QC.2** Should the format of IDs be standardised? (pre-fill: show detected variants, e.g. `s10023` vs `S10023`) `[single: Yes → target: UPPERCASE / lowercase / No]`

### C-Date — for each date column

**QC.3** What format do the dates arrive in? `[single: DD/MM/YYYY / MM/DD/YYYY / YYYY-MM-DD / Mixed formats / Not sure]` (pre-fill from sample)
→ IF *Mixed* or *Not sure*: script parses day-first (UK convention, stated explicitly in the generated code), tries listed patterns in priority order, and **reports** every value it could not parse. Unparseable values are treated per the column's missing-value rule (Section D).
**QC.4** What format should dates be in after cleaning? `[single: YYYY-MM-DD (recommended) / DD/MM/YYYY / Keep as they are]`
**QC.5** Must any date column come before another? `[table: Earlier column | Later column]` *(optional — asked once, not per column)*
> IF a rule is given → **QC.5a** When a record breaks the rule, what should the script do? `[single: Count and list them in the report (recommended) / Blank the later date and note it in the report]`
→ Note: exception conditions (e.g. "unless Extension Permission = Yes") are deliberately **not** offered at this stage, per the decision to defer cross-column logic. The report-only default keeps this safe: nothing is destroyed.

### C-Number — for each numeric column

**QC.6** Should values have decimal places? `[single: No, whole numbers / Yes → how many places [number] → rounding: round half up / keep as is]`
**QC.7** Do any values contain symbols or text — £, %, commas, "N/A"? `[multi: £ / % / thousands commas / other → specify]` (pre-fill from sample)
→ Script strips the listed characters and converts to numeric; anything still unconvertible is treated as missing **and** listed in the report.
**QC.8** *(optional)* Is there a sensible range? `[min / max]`
→ Out-of-range values are flagged in the report only — never altered.

### C-Category — for each categorical column

**QC.9** What are the valid final values for this column? `[list]` (pre-fill: distinct values from sample)
**QC.10** Map every variant you've seen to a valid value: `[table: Value found | Becomes]` (pre-fill: detected variants, e.g. `Pass / pass / PASS / Passed → Pass`)
**QC.11** What should happen to values that are neither valid nor mapped? `[single: Report as "unexpected value" (recommended) / Set to "Unknown" / Keep unchanged]`

---

## Section D — Missing values

Asked per column, but **only** for columns where the sample shows gaps, or the user flags them. (pre-fill list)

**QD.1** Which columns contain missing values? `[multi]` (pre-fill)
**QD.2** *(per flagged column)* What represents "missing" in this column? `[multi: blank / NA / N/A / NULL / None / 99 / other → specify]` (pre-fill from sample)
**QD.3** *(per flagged column)* What should the script do with missing values? `[single: Standardise them all to empty and report the count / Replace with a label → specify (e.g. "Unknown") / Remove the whole record / Only report the count]`

---

## Section E — Renaming columns

**QE.1** Do you want to rename any columns? `[table: Current name | New name]`
→ Validation: new names must be unique and must not clash with existing names; warn on spaces/special characters if the user's downstream tools dislike them.

---

## Section F — Cleaning actions

*(per column, `[multi]`, pre-suggested from the sample where variants are detected)*

- Collapse repeated internal spaces *(offered only for "Leave as text" columns — it is a default everywhere else; see Default hygiene rules)*
- Standardise capitalisation → `[single: UPPERCASE / lowercase / Title Case]`
- Remove specific characters → `[specify]`
- Convert type (text→number, text→date — auto-added when Sections C answers imply it)

→ Note: duplicate removal is **not** listed here; it lives with the ID rules (QC.1) so the keep-rule is never skipped.

---

## Section G — Recoding and regrouping

**QG.1** Which columns do you want to recode or regroup? `[multi]`
*(per selected column)*
**QG.2** Give the mapping rules: `[table: Old value(s) | New value | Condition (optional)]`

*Numeric banding example:*

| Old value(s) | New value | Condition |
|---|---|---|
| 1–9 | Fewer than 10 | — |
| 10–19 | 10 or more and fewer than 20 | — |
| >= 20 | 20 or more | — |

*Text example with a condition:*

| Old value(s) | New value | Condition |
|---|---|---|
| Appointment cancelled | Not attended | Academic year = 2024/25 |
| Appointment attended but late | Attended | Academic year = 2024/25 |
| Blank | Not attended | Academic year = 2024/25 |

→ Conditions referencing another column are allowed and are stored in the spec as *conditional recodes*. (This is a contained form of cross-column logic — kept because your own examples require it.)

**QG.3** What should happen to values not covered by the mapping? `[single: Keep unchanged / Set to "Unknown" / Report as unexpected]`
→ This catch-all rule is required — without it the script must guess.

---

## Section H — Your cleaned file

**QH.1** Name for the cleaned file? `[text — default: <original name>_cleaned]`
**QH.2** Format? `[single: Same as input / CSV / Excel]`
**QH.3** *(not a question — fixed behaviour, shown as information)* Every script prints a summary report: rows read and written; per column — values changed, missing values handled, duplicates found, unparseable dates, out-of-range numbers, unexpected categories; and a final "checks passed / N issues found" line. No raw data values are printed.

---

## Final review screen (required)

Before anything is generated, show the assembled brief in plain language, grouped by column, e.g.:

> **Student ID** — must be unique; duplicates: keep last occurrence; standardise to UPPERCASE.
> **Assessment Deadline** — arrives DD/MM/YYYY; clean to YYYY-MM-DD; must be on or before Assessment Complete Date: violations reported only.
> **Result Status** — valid values: Pass, Fail, Deferred; 4 variants mapped; unmapped values reported.

User can jump back to edit any section. **Approve** converts the brief to the spec JSON, which is validated against the Pydantic contract, rendered through the prompt template, and sent to the coder.

---

## Implementation notes for Antigravity

1. Each answer maps to a named field in the spec — no answer should exist that the contract cannot hold, and no contract field required for generation should lack a question. Please reconcile against `data_contract.py` and flag mismatches rather than improvising.
2. The interview state must be saveable and resumable; losing 40 answers to a refresh is fatal for trust.
3. Question rendering: one section visible at a time, progress indicator, and "skip — not applicable" wherever the branch allows.
4. Accessibility: all controls keyboard-operable, labels programmatically associated, to WCAG 2.2 AA.

## Changes from Helen's draft, at a glance

| Gap in original | Closed by |
|---|---|
| Date formats (incoming + target, UK day-first) | QC.3, QC.4 |
| Rename asked but new names never collected | QE.1 |
| Missing values identified but no treatment | QD.3 |
| Dedupe without a keep rule | QC.1b |
| Categorical columns without a canonical value set | QC.9–QC.11 |
| Pasted headers fragile (commas) | QB.1: one-per-line + upload-first |
| Numeric symbols (£, %, commas) | QC.7 |
| Date-ordering rule without a violation action | QC.5a |
| No catch-all for unmapped recode values | QG.3 |
| No output file name/format | QH.1–QH.2 |
| "Free text columns" question with no action | Removed; QB.2 default-unchanged covers it |
| Re-upload wiping user answers | QB.1 merge-by-name rule |
| Header spaces causing KeyErrors; space-trimming left as opt-in | Default hygiene rules (applied at read time, headers included) |
