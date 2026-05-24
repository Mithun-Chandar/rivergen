# Contributing to RiverGen

RiverGen is a focused tool with a specific philosophy. The most valuable contributions preserve that focus rather than expand it.

---

## What the project is

RiverGen enforces a single architectural law: **one verified path from mutation to cache.** Every design decision — the generator, the gates, the Witness layer — exists to make that law hold as products grow and teams change.

Contributions that reinforce this are welcome. Contributions that introduce new architectural assumptions or blur the One River concept should be discussed first.

---

## What is in scope

- Bug fixes in any of the 12 gates
- Correctness fixes in generated template stubs
- New `rivergen.config.json` options that reduce hard-coded path assumptions
- Improvements to gate error messages (clarity, actionability)
- Documentation corrections
- Witness assertion helper improvements

## What requires an issue first

- New framework support (Hono, Fastify, SWR, Bun) — planned, but needs design discussion
- New gates — open an issue describing the violation pattern and why existing gates don't catch it
- Changes to the One River data flow — this is the core invariant; discuss before implementing
- Changes to the spec format — breaking changes affect all existing specs

## What is out of scope

- UI tooling, dashboards, or visualizers — these belong in the commercial layer, not the OSS core
- New architectural patterns that compete with One River
- Gate relaxations or opt-out mechanisms

---

## How the gate system works

The 12 gates in `gates/` are the project's correctness layer. There are no unit tests for the generator itself — the gates *are* the test harness.

When you change a template, run the gates against a real project that uses the changed template:

```bash
rivergen verify
```

All 12 gates must pass. Gate #12 is the expected incomplete state after `rivergen gen` — it moves from stub to passing once the developer fills the witness file lifecycle assertions. All other 11 gates must stay green immediately after generation.

If you are adding a new gate, it must:

1. Have a named violation pattern that is unambiguously wrong
2. Produce an actionable error message pointing to the specific file and line
3. Not produce false positives on correctly generated code

---

## How Witness works

Witness (`gates/gate-witness-coverage.ts`, `gates/layer3-runner.ts`) runs projection functions against a minimal in-process QueryClient and asserts field continuity across the full cache convergence path.

When changing projection templates or entity-cache helpers, run the full Witness suite and check Layer 3 assertion counts:

```
rivergen verify
# Look for: Layer 3: N/N assertions passed
```

A reduction in assertion count without a corresponding spec change is a regression.

---

## Submitting a PR

1. Fork and clone
2. Make your change
3. Run `rivergen verify` against a project using the changed template — include the output in your PR description
4. If you changed a gate: include a before/after showing the violation it catches and that it does not fire on correct code
5. Keep the PR focused — one concern per PR

## Filing a bug

Include:

- The spec file used
- The full `rivergen verify` output
- The specific file and line where generated output is wrong
- What you expected vs. what you got

Use the issue template in `.github/ISSUE_TEMPLATE/bug_report.md`.
