//@ backend dafny

/**
 * Pure poll-scoring core. Verified with LemmaScript (Dafny backend).
 *
 * Input:  per-option yes/ifNeedBe vote counts (pre-extracted from raw vote rows).
 * Output: scored options with isTopChoice flag, plus highScore.
 *
 * Score formula: (yes + ifNeedBe) * 1000 + yes
 *   - Primary ranking: total availability (yes + ifNeedBe).
 *   - Tiebreaker: yes count.
 *
 * Top choice: an option whose score equals highScore AND highScore > 0.
 *   The "> 0" rule prevents declaring a winner when no one voted yes/ifNeedBe.
 */

export interface OptionVotes {
  id: string;
  yes: number;
  ifNeedBe: number;
}

export interface ScoredOption {
  id: string;
  yes: number;
  ifNeedBe: number;
  score: number;
  isTopChoice: boolean;
}

export interface PollScoring {
  options: ScoredOption[];
  highScore: number;
}

export function scorePoll(input: OptionVotes[]): PollScoring {
  //@ verify
  // Preconditions: vote counts are non-negative, and yes counts fit the
  // tiebreaker encoding (< 1000) so the score formula stays injective.
  //@ requires forall(i: nat, i < input.length ==> input[i].yes >= 0 && input[i].ifNeedBe >= 0)
  //@ requires forall(i: nat, i < input.length ==> input[i].yes < 1000)
  // Length preservation: one scored option per input option.
  //@ ensures \result.options.length === input.length
  // highScore non-negativity: holds even when no option has any votes
  // (the `, 0` floor in `Math.max(...scores, 0)`).
  //@ ensures \result.highScore >= 0
  // Per-option score non-negativity: each score is in [0, highScore].
  //@ ensures forall(i: nat, i < \result.options.length ==> \result.options[i].score >= 0)
  // highScore is the upper bound: every per-option score is <= highScore.
  //@ ensures forall(i: nat, i < \result.options.length ==> \result.options[i].score <= \result.highScore)
  // Top-choice characterization: isTopChoice iff score equals highScore AND
  // highScore > 0 (the "> 0" rule prevents declaring a winner when no one voted).
  //@ ensures forall(i: nat, i < \result.options.length ==> \result.options[i].isTopChoice === (\result.options[i].score === \result.highScore && \result.options[i].score > 0))
  // Score formula: pins the (yes + ifNeedBe) * 1000 + yes encoding at the spec level.
  //@ ensures forall(i: nat, i < \result.options.length ==> \result.options[i].score === (input[i].yes + input[i].ifNeedBe) * 1000 + input[i].yes)
  // Within-poll monotonicity: a strictly-better option ranks at least as high.
  //@ ensures forall(i: nat, forall(j: nat, i < \result.options.length && j < \result.options.length && input[i].yes >= input[j].yes && input[i].ifNeedBe >= input[j].ifNeedBe ==> \result.options[i].score >= \result.options[j].score))
  // Tiebreaker injectivity: same score implies same (yes, ifNeedBe) — the
  // * 1000 + yes encoding is uniquely decodable when yes < 1000.
  //@ ensures forall(i: nat, forall(j: nat, i < \result.options.length && j < \result.options.length && \result.options[i].score === \result.options[j].score ==> input[i].yes === input[j].yes && input[i].ifNeedBe === input[j].ifNeedBe))
  const scores: number[] = input.map(
    (o) => (o.yes + o.ifNeedBe) * 1000 + o.yes,
  );
  const highScore = Math.max(...scores, 0);

  let options: ScoredOption[] = [];
  let i = 0;
  while (i < input.length) {
    //@ type i nat
    //@ invariant 0 <= i && i <= input.length
    //@ invariant options.length === i
    //@ invariant forall(j: nat, j < i ==> options[j].score === scores[j])
    //@ invariant forall(j: nat, j < i ==> options[j].score >= 0)
    //@ invariant forall(j: nat, j < i ==> options[j].score <= highScore)
    //@ invariant forall(j: nat, j < i ==> options[j].isTopChoice === (options[j].score === highScore && options[j].score > 0))
    const o = input[i];
    const score = scores[i];
    options = [
      ...options,
      {
        id: o.id,
        yes: o.yes,
        ifNeedBe: o.ifNeedBe,
        score: score,
        isTopChoice: score === highScore && score > 0,
      },
    ];
    i = i + 1;
  }

  return { options, highScore };
}
