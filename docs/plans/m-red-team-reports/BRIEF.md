# M step 2 — shared brief for every finder

Repo: /Users/javier/Documents/src.nosync/personal/agent-researcher (main checkout, HEAD 5391cbd).
Read FIRST, in this order:
1. docs/plans/m-red-team.md — the plan, the surfaces, the rules, and § 5 (what the harness already measured).
2. docs/plans/deep-review.md § M (lines ~635-748) — the first finding, already fixed, and how it was argued.
3. The harness: packages/core/test/fixtures/poisoned-web.ts, packages/core/test/mocks/obedient-llm.ts,
   packages/core/test/fixtures/red-team-model.ts, packages/core/test/red-team-harness.test.ts.
   Run it once: `cd packages/core && npx vitest run test/red-team-harness.test.ts` (prints the reach table).
4. The code under attack: packages/core/src/engine/prompt.ts, gather.ts, research-engine.ts, synthesize.ts;
   packages/core/src/pdf/report-html.ts; apps/fbizlab/src/components/ReportViewer.tsx; apps/fbizlab/src/pages/JobView.tsx.

## What counts
A finding is REAL only if it changes (a) what a buyer receives (web viewer, PDF, email, progress line, shared read page),
(b) what we store (report.json, checkpoint, trace, progress, job fields, sources), or (c) what we spend (turns, chars sent,
model calls, dollars). A model saying something odd inside a prompt or a trace is NOT a finding.
The pre-screen (moderation) is OUT of scope. The buyer's free-text `instructions` channel is DECIDED: it will be removed
from the prompt (see plan § A) — measure it if it is on your surface, do not propose fences for it.

## Rules
- Tier: MOCK. Use the harness (poisoned web + ObedientMockProvider + redTeamModel). You may add payloads to
  poisoned-web.ts ONLY by adding entries (never edit existing ones), or define payloads locally in your test file.
- You MAY use `TEST_LLM=ollama` (a local server is up at localhost:11434, qwen2.5:3b) for ONE confirming run of a
  finding where the model's behaviour is the mechanism. Never a paid model — `no-paid-calls.ts` throws anyway.
- Every finding: `file:line`, the exact input (payload text), the observed output, and **reproduced** (a test showed it)
  vs **reasoned** (read only). Refute your own finding first: check whether the schema parse, `splitHandoff`,
  `stripFenceMarker`, `esc()`, react-markdown's urlTransform, the iteration bound, or a caller already neutralises it.
- Write your evidence as vitest tests in NEW files only:
  packages/core/test/red-team/<your-id>.test.ts  (core; `vi.mock('../../src/tools/web-search.js', () => import('../fixtures/fake-web.js'))`,
  note the extra `../` from the subdirectory) or apps/fbizlab/test/red-team-<your-id>.test.tsx (viewer).
  Do NOT modify any file under src/. Do NOT commit. Other finders run in the same checkout in parallel — touch only your files.
- A test that demonstrates a defect should FAIL against today's code (or be an `it.fails`/`todo` with the measured
  numbers in its name) — say explicitly which. A test that pins a guard must be revert-verified: describe the one-line
  mutation that turns it red. Assert CONTENT, not shape (a comment claiming more than the assertion is the repo's most
  common defect).
- Measure in this checkout; if you use a worktree for anything, run packages/core/test/resolution.test.ts first.
- Time-box: aim for depth on 3-6 things, not breadth. Stop when you have them.

## Report
Write your report to /private/tmp/claude-501/-Users-javier-Documents-src-nosync-personal-agent-researcher/f5dedb44-1290-441c-b6ae-6bf6564fc5fe/scratchpad/m-step2/<your-id>.md
AND return the same text as your final message. Format:

# <your-id> — <surface> / <lens>
## Verdict for the surface: held | held by accident | broken  (one line why)
## Findings (most severe first)
### F1 · <one-line damage statement>
- where: file:line
- input: <exact payload / request>
- observed: <exact output, numbers>
- status: reproduced (test: path::name) | reasoned
- refutation attempted: <what you checked that could have neutralised it, and why it does not>
- fix sketch (2 lines max) + what a legit request would lose if fixed naively
## Checked and found sound (so nobody re-reports it)
## Tests written (paths, and for each: fails today / pins a guard + mutation that reds it)
