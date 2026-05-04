# Rallly — Verified with LemmaScript (nascent)

Fork of [lukevella/rallly](https://github.com/lukevella/rallly) with one production function — `validateRedirectUrl` in `apps/web/src/utils/redirect.ts` — annotated and verified in-place against the [LemmaScript](https://github.com/midspiral/LemmaScript) Dafny backend. [Diff vs. main.](https://github.com/midspiral/rallly-lemmascript/compare/main..lemmascript)

**Status: nascent.** One function, three postconditions, body unchanged. Smaller than hono/casbin/xyflow. Exists to demonstrate the in-place workflow on a Next.js app and to pin three LemmaScript additions (see [Notes for LemmaScript](#notes-for-lemmascript)). **Not** a comprehensive verification of Rallly.

## What's Verified

```typescript
//@ verify
//@ ensures \result !== undefined ==> \result.startsWith("/")
//@ ensures \result !== undefined ==> !\result.startsWith("//")
//@ ensures \result !== undefined ==> \result.length >= 1
```

Any non-`undefined` output is a single-slash absolute path on the same origin — the function cannot return `https://evil.com`, `//evil.com`, or `""`. 5 VCs, 0 errors. The other function in the file (`buildSafeRedirectUrl`) uses `URLSearchParams` and is silently skipped (selective mode, SPEC §2.6).

## Caveats

Two model/runtime divergences. Both safe-direction (verified ⊆ runtime safe), but real:

1. **`StringTrim` strips only ASCII space (`0x20`).** JS `.trim()` also strips `\t \n \r \v \f`, NBSP `\xA0`, and other Unicode whitespace. Same shape as [hono CVE-2026-39410](https://github.com/honojs/hono/security/advisories/GHSA-r5rp-j6wh-rvv4).
2. **`!s` on `Option<string>` lowers to "is None".** JS also treats `Some("")` as falsy; the model lets `""` fall through (still safe — empty string fails the `startsWith("/")` check).

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

Reads `LemmaScript-files.txt` (a single line: `apps/web/src/utils/redirect.ts`), regenerates `apps/web/src/utils/redirect.dfy.gen`, and runs `dafny verify` on `apps/web/src/utils/redirect.dfy`. CI runs the same script on every push (`.github/workflows/lemmascript.yml`) and asserts the regenerated `.dfy.gen` matches what's committed (catches drift between the TS source and the verified artifact).

## What's Next

In rough priority order — each item is a separate piece of work, not a roadmap commitment.

1. **Tighten the `StringTrim` gap.** The cleanest version of this case study mirrors hono's `trimCookieWhitespace` story: replace `.trim()` with an explicit `charCodeAt`-based loop that only strips a documented set (e.g., `0x20` and `0x09`), and verify that loop is correct character-by-character. The before/after diff *is* the case study — same shape as the hono CVE writeup.
2. **Verify a second function.** Candidates with a similar small-but-real shape: `isBusinessEmail` (set-membership predicate over the free-domain list), `getSelfHostedSeatLimit` (license-tier → seat-count switch with bounds). Together with `validateRedirectUrl` these would form a "verified utility belt" closer in scope to xyflow's nine-function case study.
3. **Verify the poll-scoring core.** `getPollResults` in `apps/web/src/features/poll/data.ts` contains the actual ranking logic for meeting polls — the score formula `(yes + ifNeedBe) * 1000 + yes`, top-choice maximality, tie-breaker correctness. The function is `async` + Prisma-bound, so this requires extracting the pure scoring loop into a same-file helper before annotating it. This is the only candidate that would yield a Tier-1 algorithmic theorem at Rallly's scale; everything else in the codebase is React, tRPC, or Prisma queries that are out of fragment.

## Notes for LemmaScript

This case study drove three LemmaScript additions, all in service of making the spec `\result !== undefined ==> \result.startsWith("/")` work:

- `s.startsWith(prefix)` in the string special-forms table (Dafny: `|s| >= |p| && s[..|p|] == p`).
- `parseTsType` collapses `T | null | undefined` to `Option<T>` (previously it only handled `T | undefined`, leaving `string | null` as a `user` type).
- `\result` is desugared (in `resolve`) to a regular IR variable named `"\\result"`, with the ensures-context environment pre-seeded so that `\result === undefined` premise narrowing under `==>` works through the standard variable-narrowing infrastructure. Both backends' `escapeName` render the IR name back to `res` at emit time — the canonical Dafny/Lean return-value identifier.

These are now exercised by Rallly's CI matrix entry in [`LemmaScript/.github/workflows/ci.yml`](https://github.com/midspiral/LemmaScript/blob/main/.github/workflows/ci.yml), so a regression in any of the three would fail before LemmaScript merges.

## How It Works

Annotations are TypeScript comments — invisible to `tsc`, visible to LemmaScript:

```typescript
//@ verify
//@ ensures \result !== undefined ==> \result.startsWith("/")
```

The `//@ backend dafny` directive at the top of `redirect.ts` restricts this file to the Dafny backend (Lean's string fragment doesn't include `.trim()`). Other functions in the file without `//@ verify` are silently skipped — selective verification per LemmaScript SPEC §2.6.

For a fuller introduction, see the [LemmaScript blog post](https://midspiral.com/blog/lemmascript-a-verification-toolchain-for-typescript/) and [SPEC.md](https://github.com/midspiral/LemmaScript/blob/main/SPEC.md).
