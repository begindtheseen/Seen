// The shared posting-pay reader (P2 round 4, coordinator): rates written without "$" or with a glued unit are read;
// premiums, bonuses, 401k, 24/7 and revenue figures never are.
// Run: node --test lib/jobs/postingPay.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPostingPay } from './postingPay.js';

const read = (t) => readPostingPay(t)?.text || null;

test('reads a rate written without "$", with a glued unit, in words or after USD', () => {
  assert.equal(read('Wage: 21.00/hr'), '$21.00 an hour');
  assert.equal(read('Pay: $21hr'), '$21 an hour');
  assert.equal(read('Pay range is 21-24 dollars per hour'), '$21 – $24 an hour');
  assert.equal(read('Pay: USD 21/hour'), '$21 an hour');
  assert.equal(read('Earn up to $21 an hour on day shift.'), 'Up to $21 an hour');
  assert.equal(read('The salary range for this position is $36.50 - $58.40 (Hourly Rate)'), '$36.50 – $58.40 an hour');
});

test('never reads a premium, a bonus, a 401k, 24/7 or a revenue figure as pay', () => {
  assert.equal(read('Shift premium: $21/hour premium for night shift'), null);
  assert.equal(read('$500 sign-on bonus after 90 days'), null);
  assert.equal(read('We offer a 401k match up to 4%.'), null);
  assert.equal(read('Our support team is available 24/7.'), null);
  assert.equal(read('We grew revenue to $40 million last year.'), null);
  assert.equal(read('Samsara is growing 30%+ at ~$2B ARR.'), null);
  assert.equal(read('Perks include gym membership reimbursement (up to $75/month).'), null);
});
