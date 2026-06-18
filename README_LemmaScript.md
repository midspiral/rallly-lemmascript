# Rallly — Verified with LemmaScript

[![LemmaScript verified](https://img.shields.io/github/actions/workflow/status/midspiral/rallly-lemmascript/lemmascript.yml?branch=lemmascript&label=LemmaScript%20verified)](https://github.com/midspiral/rallly-lemmascript/actions/workflows/lemmascript.yml)


Fork of [lukevella/rallly](https://github.com/lukevella/rallly) with two pieces of production logic verified against the [LemmaScript](https://github.com/midspiral/LemmaScript) Dafny backend: a redirect-URL safety predicate (in-place) and the poll-scoring core (extracted helper). [Diff vs. main.](https://github.com/midspiral/rallly-lemmascript/compare/main..lemmascript)

Two functions, ten verification conditions, zero errors. The case study also drove four additions to LemmaScript itself (see [Notes for LemmaScript](#notes-for-lemmascript)). Smaller in scope than `node-casbin` or `clear-split`; comparable to `xyflow`.

## What's Verified

### `validateRedirectUrl` — `apps/web/src/utils/redirect.ts` (in-place)

Body unchanged. Three ensures clauses pin the open-redirect property:

```typescript
//@ verify
//@ ensures \result !== undefined ==> \result.startsWith("/")
//@ ensures \result !== undefined ==> !\result.startsWith("//")
//@ ensures \result !== undefined ==> \result.length >= 1
```

Any non-`undefined` output is a single-slash absolute path on the same origin — the function cannot return `https://evil.com`, `//evil.com`, or `""`. The other function in the file (`buildSafeRedirectUrl`) uses `URLSearchParams` and is silently skipped (selective mode, SPEC §2.6).

5 VCs, 0 errors.

### `scorePoll` — `apps/web/src/features/poll/scoring.ts` (extracted core)

The ranking core of `getPollResults` extracted into a pure helper. The async/Prisma shell stays in `data.ts` and calls into `scorePoll` after building per-option `{yes, ifNeedBe}` counts. Public return shape of `getPollResults` is preserved exactly.

Eight ensures clauses pin the ranking semantics. The score formula is `(yes + ifNeedBe) * 1000 + yes`:

- **Length preservation.** Output has one scored option per input option.
- **`highScore` non-negativity.** Holds even when no one voted (the `, 0` floor in `Math.max(...scores, 0)`).
- **Score non-negativity.** Every per-option score is ≥ 0.
- **`highScore` upper bound.** Every per-option score is ≤ `highScore`.
- **Top-choice characterization.** `isTopChoice` iff `score === highScore && highScore > 0`. The "> 0" rule prevents declaring a winner when no one voted.
- **Score formula.** Pins `(yes + ifNeedBe) * 1000 + yes` at the spec level (not just the implementation level).
- **Within-poll monotonicity.** If option A's `yes` and `ifNeedBe` both dominate option B's, then A's score is at least B's. A strictly-better option can't rank lower.
- **Tiebreaker injectivity.** Equal scores ⇒ equal `(yes, ifNeedBe)`. The `* 1000 + yes` encoding is uniquely decodable, so two options with the same score must have identical `(yes, ifNeedBe)` tallies.

The injectivity theorem requires a `yes < 1000` precondition — and that's a real spec-level finding worth flagging. The score formula has 1000 as the encoding base, so any option with ≥ 1000 `yes` votes overflows into the `(yes + ifNeedBe) * 1000` slot and the formula stops being uniquely decodable. In practice, rallly polls have far fewer voters per option, so this isn't a live bug; but it's a quietly-load-bearing assumption in the existing implementation that the verified spec now makes explicit.

5 VCs, 0 errors. The `.dfy` file has a one-line proof addition (`MaxOfSeqConcat(scores, [0])`); everything else is auto-discharged.

## Caveats

Two model/runtime divergences in `validateRedirectUrl`. Both safe-direction (verified ⊆ runtime safe), but real:

1. **`StringTrim` strips only ASCII space (`0x20`).** JS `.trim()` also strips `\t \n \r \v \f`, NBSP `\xA0`, and other Unicode whitespace. Same shape as [hono CVE-2026-39410](https://github.com/honojs/hono/security/advisories/GHSA-r5rp-j6wh-rvv4).
2. **`!s` on `Option<string>` lowers to "is None".** JS also treats `Some("")` as falsy; the model lets `""` fall through (still safe — empty string fails the `startsWith("/")` check).

For `scorePoll`, the boundary worth flagging: `data.ts` extracts `yes` / `ifNeedBe` counts from the raw Prisma `groupBy` rows via a `find`-based helper (`votes.find((v) => v.type === type)?.count ?? 0`). That extraction is **not** verified — it's the unverified shell around the verified core. The `scorePoll` proof assumes the input `{yes, ifNeedBe}` non-negativity precondition is honored by callers; `data.ts` constructs counts via Prisma's `_count` aggregation which is non-negative by construction.

## Setup

**Prerequisites:** [Dafny](https://github.com/dafny-lang/dafny) ≥ 4.0, Node.js ≥ 18.

```sh
git clone https://github.com/midspiral/LemmaScript.git ../LemmaScript
cd ../LemmaScript/tools && npm install && cd -
```

## Verify

```sh
../LemmaScript/tools/check.sh dafny
```

Reads `LemmaScript-files.txt` (currently lists `apps/web/src/utils/redirect.ts` and `apps/web/src/features/poll/scoring.ts`), regenerates each `.dfy.gen`, and runs `dafny verify` on each `.dfy`. CI runs the same script on every push (`.github/workflows/lemmascript.yml`) and asserts the regenerated `.dfy.gen` matches what's committed (catches drift between the TS source and the verified artifact).

## What's Next

In rough priority order — each item is a separate piece of work, not a roadmap commitment.

1. **Tighten the `StringTrim` gap.** Replace `.trim()` in `validateRedirectUrl` with an explicit `charCodeAt`-based loop that only strips a documented set (e.g., `0x20` and `0x09`), and verify that loop is correct character-by-character. The before/after diff *is* the case study — same shape as the [hono cookie CVE writeup](https://github.com/midspiral/hono-lemmascript/blob/lemmascript/src/utils/cookie.ts#L79).
2. **Verify a third function.** Candidates with a similar small-but-real shape: `isBusinessEmail` (set-membership predicate over the free-domain list), `getSelfHostedSeatLimit` (license-tier → seat-count switch with bounds). Together with `validateRedirectUrl` and `scorePoll` these would form a "verified utility belt" closer in scope to xyflow's nine-function case study.
3. **Cross-poll ranking soundness for `scorePoll`.** Beyond the within-poll properties already proven, sort-by-descending-score should produce a valid total-availability-then-yes ordering. This requires reasoning about a sort permutation; non-trivial proof effort.

## Notes for LemmaScript

This case study drove four LemmaScript additions, exercised by the Rallly entry in [`LemmaScript/.github/workflows/ci.yml`](https://github.com/midspiral/LemmaScript/blob/main/.github/workflows/ci.yml). Regressions in any of these would fail the LemmaScript CI before merging.

- **`s.startsWith(prefix)`** — added to the string special-forms table (Dafny: `|s| >= |p| && s[..|p|] == p`).
- **`parseTsType` and `null` nullability.** Collapses `T | null | undefined` to `Option<T>` (previously it only handled `T | undefined`, leaving `string | null` as a user type).
- **`\result` narrowing under `==>`.** `\result` is desugared (in `resolve`) to a regular IR variable named `"\\result"`, with the ensures-context environment pre-seeded so that `\result === undefined` premise narrowing works through the standard variable-narrowing infrastructure. Both backends' `escapeName` render the IR name back to `res` at emit time.
- **`Math.max` / `Math.min` with spread args.** `Math.max(...arr, 0)` is rewritten at extract time to `MaxOfSeq(arr ++ [0])` (and similarly for `Math.min`). New Dafny preambles `MaxOfSeq` / `MinOfSeq` carry built-in `forall` / `exists` ensures clauses. Helper lemmas `MaxOfSeqConcat` / `MinOfSeqConcat` are available for users to invoke when proving element bounds across concatenations. First rallly use is in `scorePoll`.

## How It Works

Annotations are TypeScript comments — invisible to `tsc`, visible to LemmaScript:

```typescript
//@ verify
//@ ensures \result !== undefined ==> \result.startsWith("/")
```

The `//@ backend dafny` directive at the top of each verified file restricts it to the Dafny backend. Other functions in the same file without `//@ verify` are silently skipped — selective verification per LemmaScript SPEC §2.6.

For a fuller introduction, see the [LemmaScript blog post](https://midspiral.com/blog/lemmascript-a-verification-toolchain-for-typescript/) and [SPEC.md](https://github.com/midspiral/LemmaScript/blob/main/SPEC.md).
