/**
 * The closed vocabulary the assisted pre-flight pass may answer with.
 *
 * `allowedIssueCodes` is the enum handed to the model; `ISSUE_COPY` is what turns
 * an answer into a sentence for the buyer. They were two hand-written lists, and
 * they drifted: `instructions_vague` outlived the free-text instructions field
 * itself (`7a45269` removed it), no rule emitted it, and against a real model it
 * was picked with the box empty — so the buyer read "the free-text instructions are
 * vague" about a control that is not on the form (round 7, R7-10).
 */
import { describe, it, expect } from 'vitest';
import { coreIssueMessage, CORE_ISSUE_CODES } from '../src/moderation/copy.js';
import { allowedIssueCodes } from '../src/moderation/deterministic.js';
import { getTemplate } from '../src/templates/registry.js';

describe('the issue codes a model may choose', () => {
  it('says nothing about free-text instructions — the field is gone', () => {
    // Mutation that reds this: put `instructions_vague` back in `CORE_ISSUE_CODES`.
    const codes = allowedIssueCodes(getTemplate('florida-business-for-sale'));
    expect(codes).not.toContain('instructions_vague');
    for (const lang of ['en', 'es', 'fr', 'pt'] as const) {
      expect(coreIssueMessage('instructions_vague', lang), lang).toBeUndefined();
    }
  });

  it('all carry copy, in every language — the enum and the copy table are one list', () => {
    // The drift itself, not the one symptom: a code the model may answer with and
    // that has no sentence renders as nothing at all on the buyer's dialog.
    for (const code of CORE_ISSUE_CODES) {
      for (const lang of ['en', 'es', 'fr', 'pt'] as const) {
        expect(coreIssueMessage(code, lang), `${code}/${lang}`).toBeTruthy();
      }
    }
    expect(allowedIssueCodes(undefined)).toEqual([...CORE_ISSUE_CODES]);
  });
});
