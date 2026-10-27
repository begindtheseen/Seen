// A typed fill belongs to the sentence it finished (round 4: a rebuild stitched typed words onto another story).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { givenKey, carryFills, fillTarget } from './prepFills.js';

const q = 'Tell me about a time you noticed something was hurting users and fixed it without being asked.';
const ledger = 'At Ledgerline, where I was a Senior Backend Engineer, I built idempotent payment-orchestration APIs. [What went wrong, how you found the cause, and what you changed so it would not happen again.]';
const heb = 'At H-E-B Digital, where I was a Software Engineer, I built Go microservices for curbside order slotting serving more than 300 stores. [What went wrong, how you found the cause, and what you changed so it would not happen again.]';

test('the given text decides: the same sentence keeps the fill, a different one turns it into a note', () => {
  const prior = { answers: [{ q, answer: ledger }], fills: { [q]: ['Two services were writing balances out of order…'] } };
  const same = carryFills(prior, { answers: [{ q, answer: ledger }] });
  assert.deepEqual(same.fills, prior.fills); assert.deepEqual(same.notes, {});
  const moved = carryFills(prior, { answers: [{ q, answer: heb }] });
  assert.deepEqual(moved.fills, {}, 'never stitched onto a story the person did not tell');
  assert.deepEqual(moved.notes, { [q]: ['Two services were writing balances out of order…'] });
  // the question left the pack: the words are still theirs
  const gone = carryFills(prior, { answers: [{ q: 'Other?', answer: 'x [y]' }] });
  assert.deepEqual(gone.notes, { [q]: ['Two services were writing balances out of order…'] });
  // a different prompt inside the bracket is not a different sentence
  assert.equal(givenKey('At X, I did Y. [one thing]'), givenKey('At X, I did Y. [another thing]'));
  assert.notEqual(givenKey('The posting lists $33.65 - $40.87, and that range works for me. [a]'), givenKey("From what I've seen for this kind of role, $56k–$73k a year. [a]"));
});

test('the intro and the emails are fillable too', () => {
  const pack = { intro: 'I just finished a BA. [the one thing that drew you to this job]', emails: { thankYou: { body: 'Hi [interviewer\'s name],\nThanks.' }, followUp: { body: 'Hello [name].' } }, answers: [] };
  assert.match(fillTarget(pack, '__intro__'), /^I just finished/);
  assert.match(fillTarget(pack, '__thankyou__'), /^Hi \[/);
  assert.match(fillTarget(pack, '__followup__'), /^Hello/);
  assert.equal(fillTarget(pack, 'nope'), null);
  const carried = carryFills({ ...pack, fills: { __intro__: ['the pay transparency'] } }, pack);
  assert.deepEqual(carried.fills, { __intro__: ['the pay transparency'] });
});

test('round 6: a note comes back as a finished answer when a later rebuild restores the sentence it was typed into', () => {
  const prior = { answers: [{ q, answer: ledger }], fills: { [q]: ['Two services were writing balances out of order…'] } };
  const changed = carryFills(prior, { answers: [{ q, answer: heb }] });
  assert.deepEqual(changed.fills, {});
  assert.deepEqual(changed.notes[q], ['Two services were writing balances out of order…']);
  assert.ok(changed.noteKeys[q], 'the sentence the note was typed into is remembered');
  const packAfter = { answers: [{ q, answer: heb }], fills: changed.fills, notes: changed.notes, noteKeys: changed.noteKeys };
  const restored = carryFills(packAfter, { answers: [{ q, answer: ledger }] });
  assert.deepEqual(restored.fills[q], ['Two services were writing balances out of order…']);
  assert.equal(restored.notes[q], undefined);
  assert.equal(restored.noteKeys[q], undefined);
  // a question that comes back with yet another sentence keeps the words as notes
  const other = carryFills(packAfter, { answers: [{ q, answer: ledger.replace('idempotent payment-orchestration APIs', 'a ledger service') }] });
  assert.deepEqual(other.fills, {});
  assert.ok(other.notes[q]);
});

test('round 7: note keys hold no NUL — Postgres jsonb refused the whole rebuild write when one did', () => {
  const prior = { answers: [{ q, answer: ledger }], fills: { [q]: ['words'] } };
  const out = carryFills(prior, { answers: [{ q, answer: heb }] });
  const json = JSON.stringify(out);
  assert.ok(!/\\u0000/.test(json) && !json.includes('\u0000'), json);
  assert.ok(!givenKey(ledger).includes('\u0000'));
  assert.notEqual(givenKey(ledger), givenKey(heb));
  assert.equal(givenKey('Hi [name], thanks'), givenKey('Hi [interviewer], thanks'));
});
