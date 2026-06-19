---
name: review
description: Quality + security gate for the CURRENT git diff. Runs three passes — de-bloat, code-review, security — applies the safe fixes inline, and confirms typecheck + unit tests still pass without weakening any CLAUDE.md trust guarantee. Use after each feature and before each commit.
---

# /review — pre-commit quality + security gate

Run **on the current diff**, in order: **A) de-bloat → B) code-review → C) security.** Apply the
**safe** fixes inline; list anything risky as findings for a human. Finish only when the deterministic
gate is green.

**Before you start, read [CLAUDE.md](../../../CLAUDE.md).** No fix may weaken a trust guarantee —
grounding/citation, injection containment, code-owned severity/inclusion, PII redaction. If a fix
would, **do not apply it; report it.**

## Scope — what "current diff" means
1. Run `git status --porcelain` and `git diff --stat HEAD` to list changed + untracked files.
2. Review uncommitted changes vs `HEAD`, **including new untracked files**. Ignore `node_modules/`,
   build output, and lockfiles.
3. If the working tree is clean, review the most recent commit (`git show HEAD`).

Only touch files in the diff (plus a directly-required fix).

## Pass A — De-bloat (strip the cruft)
- Remove dead code, unreachable branches, unused vars / imports / exports, commented-out blocks.
- Delete **redundant comments** that restate the code; keep comments that explain *why*.
- Cut needless abstraction: single-call-site indirection, premature interfaces, speculative config,
  re-wrapping the SDK for no reason — inline it.
- Strip AI cruft: narration comments, `// Step 1/2/3`, debug `console.log`, defensive `try/catch` that
  swallows errors, over-explained JSDoc on obvious functions.
- Keep modules **small + single-responsibility**. If one file mixes model calls, validation, and
  rendering, flag the split (apply only if mechanical).

## Pass B — Code review (correctness + maintainability)
- Correctness: off-by-one, await/async bugs, timezone + shift-bucketing math, **array-order
  assumptions (`events.json` is NOT time-sorted)**, null / `"unknown"` handling, enum typos.
- Error handling: failures surface and are logged structured — never silently swallowed.
- Maintainability: clear names, no duplicated logic, one job per function, no `any`.
- Tests: new logic has a unit test; the **grounding-validator** and **injection** tests still assert
  what they should. Never delete or loosen a test to make the gate pass.

## Pass C — Security
- **Secrets:** no hardcoded keys/tokens; `.env` git-ignored; keys never logged or echoed; read only
  from env.
- **Prompt-injection containment:** untrusted fields (`description`, guest name, message, translated
  prose) never reach a system/instruction position; model output is untrusted until Zod-validated;
  **"all clear" is computed from the absence of items, never accepted from an event.**
- **Zod validation:** every external input (request body) AND every model-returned field is parsed
  with Zod; enums validated (DeepSeek free-texts them); reject/flag on failure — never coerce silently.
- **XSS:** all guest-controlled text (names, descriptions, translated prose) is **HTML-escaped** when
  rendered. Guest input is attacker-controlled — see `evt_0026`. No unescaped interpolation into HTML.
- **PII in logs:** structured logs redact guest names / passport / card references; log ids, room, and
  evidence refs — not raw PII.
- **Error leakage:** API responses never return stack traces, internal paths, raw model errors, or the
  prompt. Generic message out; detail to the structured log.
- **Dependencies:** `npm audit --omit=dev`; surface high/critical. Apply non-breaking `npm audit fix`;
  never `--force` without a human.

## Apply + verify
1. Apply the **safe** fixes inline — mechanical, behavior-preserving, or clear security hardening that
   leaves grounding semantics intact.
2. Run the deterministic gate: `npm run typecheck`, then `npm run test:unit` (incl. grounding-validator
   + injection tests), then `npm run lint`.
3. If a fix breaks a test or a guarantee, **revert that fix** and report it instead. The gate ends
   green; tests are never loosened to pass.
4. Re-run until clean.

## Report
End with:
- **Applied** — safe fixes, one line each (`file:line` + what).
- **Deferred (needs a human)** — risky/ambiguous findings, each with `file:line`, the risk, suggested fix.
- **Gate** — typecheck / unit tests / lint / npm audit: pass or fail.
- **Guarantees** — confirm none of grounding / injection / severity / PII was weakened.
