# Prompts for Antigravity — DataSousChef Pre-Launch Fixes

Use these one at a time, in order. Each prompt is self-contained. Wait for each task to be verified working before moving to the next.

---

## Prompt 1 — Fix the script storage bug (My Scripts page shows "Could not load scripts")

```
We have a bug in the script storage pipeline. Current behaviour: after a user
completes the questionnaire, a Python script is generated and can be downloaded
directly in the browser. However, the My Scripts page shows "Could not load
scripts", and I believe the scripts are never being saved to Firestore.

Do NOT guess at the cause. First, instrument the pipeline, then diagnose, then fix.

Step 1 — Add logging at every stage of the generation pipeline:
  a. Request received from frontend (log user ID and timestamp)
  b. LLM request sent
  c. LLM response received (log response length in characters)
  d. Script parsed/extracted from the response (log success/failure)
  e. Firestore write attempted (log the collection path and document ID used)
  f. Firestore write result (log success, or the FULL error object — do not
     swallow errors in try/catch blocks without logging them)

Step 2 — Also log what the My Scripts page does on load:
  a. The exact Firestore query it runs (collection path, filters, user ID)
  b. The result or the full error

Step 3 — Run one end-to-end test and show me the logs.

Step 4 — Based on the logs, identify the failure point. Check these specific
candidates in order:
  1. Firestore security rules rejecting the write (permission-denied error)
  2. The script + metadata exceeding Firestore's 1MB document limit. If this
     is the cause, store the script file in Cloud Storage for Firebase instead,
     and keep only metadata (title, date, user ID, storage path) in Firestore.
  3. A mismatch between the collection/user ID the write uses and the one the
     My Scripts page queries
  4. The Cloud Function timing out before the write completes (check function
     timeout settings and execution duration in the logs)

Step 5 — Fix the identified cause only. Do not refactor anything else. Then
run another end-to-end test proving: script generated → stored → appears on
My Scripts page → downloadable from there.

Keep the logging in place afterwards — reduce verbosity if needed, but every
pipeline stage must continue to log failures with full error details.
```

---

## Prompt 2 — Diagnose and cut the 10-minute generation time

```
Script generation currently takes around 10 minutes end to end. A single
Gemini 2.5 Pro call generating a Python script should take 1–3 minutes at
most, so something in our LangChain implementation is multiplying the work.
Diagnose before changing anything.

Step 1 — Instrument every LLM call. For each call, log: timestamp, model
name, purpose of the call, input token count, output token count, and wall-
clock duration. Run one full generation and show me the complete list of
calls with timings.

Step 2 — Answer these questions from the logs:
  a. How many LLM calls happen per script generation? What does each one do?
  b. Is there an agent loop, a generate-critique-regenerate chain, or any
     retry logic? If retries are happening, what errors trigger them?
  c. What is the thinking/reasoning budget configured for Gemini 2.5 Pro?
  d. How large is the prompt (input tokens)? Show me the full assembled
     prompt for one real generation.

Step 3 — Propose changes based on findings, in this priority order, and wait
for my approval before implementing:
  1. Collapse multi-call chains into ONE well-structured prompt. The
     questionnaire already gives the model complete, structured context —
     the same context that lets Claude Sonnet one-shot this task manually.
     An agent loop is redundant here.
  2. Set an explicit, moderate thinking budget for Gemini 2.5 Pro rather
     than leaving it unlimited.
  3. Remove any prompt content that isn't needed (redundant examples,
     repeated instructions).
  4. Enable streaming of the response to the frontend, with a progress
     indicator in the UI, so the user sees the script being produced.

Step 4 — After implementation, run three test generations with real
questionnaire inputs and report the new end-to-end times. Target: under
2 minutes. Confirm the generated scripts are complete and unchanged in
quality (same structure, all sections present).
```

---

## Prompt 3 — Build a three-model evaluation harness (Gemini 2.5 Pro vs Gemini 2.5 Flash vs Claude Sonnet)

```
Before launch I need evidence about which model most reliably one-shots our
script generation task. Build a small, repeatable evaluation harness. Do not
change the production pipeline — this is a separate script/tool.

Setup:
  - Since we use LangChain, make the model swappable via config. Support
    three models: gemini-2.5-pro, gemini-2.5-flash, and Anthropic's latest
    Claude Sonnet model via the Anthropic API (I will provide an API key —
    prompt me to add it to the environment config myself; never hard-code it
    or print it in logs).
  - Use the EXACT production prompt template — the same one the app uses
    after the Prompt 2 improvements — so results reflect real behaviour.

Test cases:
  - Create a folder of 10 test cases. Each test case contains:
    (1) a realistic completed questionnaire input (I will supply 5 based on
    my real datasets; generate 5 more synthetic ones covering: messy date
    formats, inconsistent categorical coding like "F"/"f"/"Female", missing
    values coded as 999/"unknown", a cross-column logical check like age vs
    date of birth, and a two-file linkage with mismatched ID formats), and
    (2) a small synthetic CSV dataset (50–200 rows) that matches the
    questionnaire description and deliberately contains the described
    problems, and
    (3) an expected-outcome checklist (e.g. "all dates parsed to ISO format",
    "gender column has exactly 2 values after recoding", "0 rows where
    end_date < start_date remain unflagged").
  - IMPORTANT: all test datasets must be synthetic. Never use real
    administrative data in the harness.

Execution — for each of the 3 models x 10 test cases:
  1. Generate the script.
  2. Run the script locally against the matching synthetic CSV in an
     isolated environment.
  3. Record: did the script execute without errors (yes/no)? Which
     expected-outcome checks passed? Generation time? Input/output tokens?
  4. Save every generated script to a results folder for my manual review.

Output:
  - A summary table: model x test case, showing execution success,
    checks passed (n/total), and generation time.
  - A totals row per model: execution success rate, average checks passed,
    average generation time, and estimated cost per generation based on
    each provider's current per-token pricing.

Make the harness re-runnable with one command so I can re-test whenever we
change the prompt or a new model version is released.
```

---

## Notes for you (not for Antigravity)

- Run these strictly in order — Prompt 2's timings are only meaningful once Prompt 1's pipeline works, and Prompt 3 must use the improved prompt from Prompt 2.
- For Prompt 3 you'll need an Anthropic API key from console.anthropic.com. Add it to your environment config yourself; don't paste it into the Antigravity chat.
- When the evaluation results come back, the decision rule is: pick the model with the highest checks-passed rate. Only use speed or cost as a tie-breaker — at your scale, all three models will cost pennies per script.
- Keep the 5 real-data questionnaire inputs you supply free of anything identifying (no real student IDs or names in example values).
