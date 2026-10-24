// Run: node --test lib/reports/excerptText.test.mjs
// Fixtures: the real /company/spacex AutoModerator row (owner screenshot 2026-10-24) and ordinary stored
// rows, whose only link is Seen's own "[Source: …]" attribution (4,208 of 4,521 public rows on prod).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeBotOrLinkText, stripAttribution, trimToSentence, decodeEntitiesOnce } from './excerptText.js';

test('HTML entities in a quote are decoded exactly once (never a double-unescape)', () => {
  assert.equal(decodeEntitiesOnce('I didn&#39;t hear back &amp; they said &quot;no&quot;'), 'I didn\'t hear back & they said "no"');
  assert.equal(decodeEntitiesOnce('&amp;lt;script&amp;gt;'), '&lt;script&gt;');       // one pass: not "<script>"
  assert.equal(decodeEntitiesOnce('plain text'), 'plain text');
  assert.equal(trimToSentence('They said &ldquo;we&rsquo;ll call&rdquo; and never did.', 500), 'They said “we’ll call” and never did.');
});
import { classifyApplicantAccount, storableAccount } from './applicantRules.js';

const AUTOMOD = 'Hello /u/Prometheus5757! Thank you for posting in r/EngineeringStudents. Please remember to: Read our [Rules](https://www.reddit.com/r/EngineeringStudents/wiki/rules) Read our [Wiki](https://www.reddit.com/r/EngineeringStudents/wiki/index) *I am a bot, and this action was performed automatically. Please [contact the moderators of this subreddit](https://www.reddit.com/message/compose/?to=/r/EngineeringStudents) if you have any questions or concerns.* [Source: https://www.reddit.com/r/EngineeringStudents/comments/abc/x/]';
const NORMAL = 'I applied to SpaceX in March, had two phone screens and an onsite interview. They rejected me for the position a week later. [Source: https://www.reddit.com/r/spacex/comments/xyz/]';

test('Seen\'s own attribution suffix is not the person\'s words — the row stays', () => {
  assert.equal(stripAttribution(NORMAL), 'I applied to SpaceX in March, had two phone screens and an onsite interview. They rejected me for the position a week later.');
  assert.equal(stripAttribution('Got the offer. [Public glassdoor.com post, posted 2025-07-30: https://www.glassdoor.com/Interview/X.htm]'), 'Got the offer.');
  assert.equal(stripAttribution('Got the offer. Source: https://www.reddit.com/r/x/comments/1/'), 'Got the offer.');
  assert.equal(stripAttribution('Got the offer. (Source: https://www.reddit.com/r/x/comments/1/)'), 'Got the offer.');
  assert.equal(stripAttribution('Got the offer. [Public reddit.com post, posted 2025-0'), 'Got the offer.'); // cap cut the attribution open
  assert.equal(looksLikeBotOrLinkText(NORMAL), false);
  assert.equal(classifyApplicantAccount(NORMAL, { names: ['SpaceX'] }).kind, 'applicant_outcome');
  assert.equal(classifyApplicantAccount(NORMAL, { names: ['SpaceX'] }).outcome, 'rejected');
});

test('a URL, a markdown link or bot boilerplate INSIDE the body disqualifies the row everywhere the rules run', () => {
  assert.equal(looksLikeBotOrLinkText(AUTOMOD), true);
  assert.deepEqual(classifyApplicantAccount(AUTOMOD, { names: ['SpaceX'], title: 'SpaceX interview', isOp: false }), { kind: 'public_commentary', reason: 'bot_or_link' });
  assert.equal(storableAccount(AUTOMOD, { names: ['SpaceX'], title: 'SpaceX interview' }), null);
  for (const body of [
    'I got the offer from SpaceX, details here https://example.com/my-offer',
    'SpaceX hired me — see www.mysite.io for the write-up',
    'SpaceX rejected me, same as [this thread](https://reddit.com/r/x/comments/1/)',
    'I am a bot, and this action was performed automatically. SpaceX hired me.',
    'Your post has been removed. Please contact the moderators if you think this is a mistake. I interviewed at SpaceX.',
    'Please remember to: Read our Rules. I applied to SpaceX and got an interview.',
    'AutoModerator: I interviewed at SpaceX and they hired me after the onsite.',
  ]) {
    assert.equal(looksLikeBotOrLinkText(body), true, body);
    assert.equal(classifyApplicantAccount(body, { names: ['SpaceX'] }).reason, 'bot_or_link', body);
  }
  // A URL only in the attribution never trips the rule; a plain mention of reddit as a word does not either.
  assert.equal(looksLikeBotOrLinkText('I found the posting on reddit and applied to SpaceX; they ghosted me. [Source: https://www.reddit.com/r/a/comments/1/]'), false);
});

test('excerpts are cut at a sentence end, never mid-word, never on a dangling quote', () => {
  const long = 'I applied in March and heard back in a week. The recruiter scheduled two phone screens and then an onsite interview. Perhaps the hardest part was the system design round, which ran long.';
  assert.equal(trimToSentence(long, 120), 'I applied in March and heard back in a week. The recruiter scheduled two phone screens and then an onsite interview.');
  assert.equal(trimToSentence(long, 1000), long);                               // within the cap → untouched
  const noStops = 'word '.repeat(40).trim();
  const cut = trimToSentence(noStops, 52);
  assert.ok(cut.endsWith('…') && !/word…$/.test(cut.replace(/ word…$/, 'x')) && cut.length <= 53, cut); // ends on a whole word + ellipsis
  assert.equal(trimToSentence('She said "we will call you tomorrow and then "', 44), 'She said "we will call you tomorrow and…');
  assert.equal(trimToSentence('He wrote: "Thanks for applying." Then nothing for weeks on end at all', 36), 'He wrote: "Thanks for applying."');
  assert.equal(trimToSentence('', 10), '');
});
