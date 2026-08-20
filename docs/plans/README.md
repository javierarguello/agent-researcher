# Plans

Work that is decided but not done. One file per body of work; each item carries
enough context to be picked up cold, months later, by someone who wasn't in the
conversation that produced it.

The convention, so items stay useful rather than decaying into a wish list:

- **An item names the damage, not the code smell.** "A zero-balance account can
  429 every paying customer" is an item; "improve rate limiting" is not.
- **Every claim cites `file:line`** and says whether it was verified by reading
  the code, by running something, or is still a hypothesis. A backlog full of
  unverified assertions is worse than no backlog.
- **Status is one of** `open` / `in progress` / `done (<commit>)` / `won't fix
  (<reason>)`. Items are struck through, never deleted — the reasoning behind a
  "won't fix" is the part you'll want later.
- **Product decisions are labelled as such.** Some entries here are not bugs;
  they are numbers someone has to choose.

**Start at [handoff.md](handoff.md).** It is the entry point: the state, the four
commands that get you running, and pointers to everything below. Every other file
here is a backlog, not a starting place.

| File | What it covers |
| --- | --- |
| [handoff.md](handoff.md) | **Read first.** Where the work stands, what is open, and the rules the rounds have paid for. |
| [deep-review.md](deep-review.md) | The rolling adversarial review of the engine, money, tenancy and prompts — rounds 1-10, every finding with the hash that closed it. The last round's "How to continue" is the ordered next-actions list. |
| [m-red-team.md](m-red-team.md) | The red-team runbook; raw reports in [m-red-team-reports/](m-red-team-reports/), one directory per round. |
| [product-backlog.md](product-backlog.md) | Things to build, as opposed to things that are broken. |
| [abuse-and-cost.md](abuse-and-cost.md) | Findings from the July 2026 adversarial review of the limits, quota and token-spend surface. |
