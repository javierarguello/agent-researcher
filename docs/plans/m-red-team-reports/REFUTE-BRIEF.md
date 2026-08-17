# M step 2 — refuter brief (shared)

Repo: /Users/javier/Documents/src.nosync/personal/agent-researcher (main checkout, HEAD 5391cbd + uncommitted finder tests under packages/core/test/red-team/ and apps/fbizlab/test/red-team-*.tsx).
You are assigned ONE finding cluster from FINDINGS.md (same directory). Your job is to REFUTE it. Default to "refuted" if you cannot make it stand on your own evidence.

Read: FINDINGS.md (your cluster), the finder report(s) it cites (A-attack.md … D-legit.md here), the tests it cites, and the source under attack. Run the cited tests. Then attack the finding from three angles:
1. Is it REAL? Does the code path actually run in production the way the finder says (check the production caller, not just the unit)? Is the "reproduced" test asserting the CONTENT the finding claims, or a shape/comment that would pass anyway? Flip each `it.fails` to `it` and read the actual assertion diff — does it fail for the stated reason?
2. Is it DAMAGE? Does it change what a buyer receives, what we store, or what we spend — by how much, and is anything already neutralising it (schema, esc(), urlTransform, iteration bound, caller guard, product decision)?
3. Is the FIX right? Would the proposed fix cost an honest run something the finder missed? Is there a narrower fix? Is there an existing test that would go red?

Rules: mock tier only unless the finding is model-behaviour (then one `TEST_LLM=ollama` run, local server at localhost:11434, is allowed). Never a paid model. Do NOT modify src/. Do NOT edit the finder's tests; if you write a test, put it in packages/core/test/red-team/refute-<cluster>.test.ts (or apps/fbizlab/test/red-team-refute-<cluster>.test.tsx), and say whether it fails today. Do not commit. Time-box: one cluster, depth over breadth.

Return (and write to m-step2/REFUTE-<cluster>.md) EXACTLY this shape:
# <cluster> — verdict: CONFIRMED | DOWNGRADED | REFUTED
- one paragraph: why (with file:line and the observed evidence you generated yourself)
- severity you assign (P0 buyer/money/data | P1 | P2 hygiene) and the ONE-sentence damage statement as it should be recorded
- fix: agree / narrower alternative / hidden honest cost (2-4 lines)
- test quality: for each cited test — asserts content? fails for the stated reason? one-line mutation that reds each pinning test (verified or reasoned)
- anything the finder missed that makes it WORSE (only if you verified it)
