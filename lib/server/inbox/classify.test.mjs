// Every rule in classify.js is pinned by an email shaped like the real ones (wording taken from the
// standard templates the big hiring systems send). The traps matter as much as the hits: a confirmation
// that says "unfortunately we can't reply to everyone" or "if selected we'll schedule an interview" must
// stay a confirmation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyEmail, detectKind } from './classify.js';
import { htmlToText, unwrapForward } from './text.js';

const c = (from, subject, text, extra = {}) => classifyEmail({ from, subject, text, ...extra });

test('Greenhouse confirmation: company from the subject, role from the body, high confidence', () => {
  const r = c('Stripe <no-reply@us.greenhouse-mail.io>', 'Thank you for applying to Stripe!',
    'Hi Brandon,\n\nThank you for your interest in Stripe! We have received your application for the Account Executive position and our team will review it shortly.\n\nIf your qualifications match our needs, a member of our recruiting team will reach out to schedule an interview.\n\nBest,\nStripe Recruiting');
  assert.equal(r.kind, 'application_received');
  assert.equal(r.company, 'Stripe');
  assert.equal(r.role, 'Account Executive');
  assert.equal(r.vendor, 'Greenhouse');
  assert.equal(r.confidence, 'high');
});

test('a confirmation that mentions an interview conditionally is NOT an interview', () => {
  const r = c('Acme Talent <noreply@acme.icims.com>', 'Application Received',
    'Thank you for applying for the Warehouse Associate role at Acme Logistics. Our team will review your application and if you are selected to move forward, we will contact you to schedule an interview.');
  assert.equal(r.kind, 'application_received');
  assert.equal(r.company, 'Acme Logistics');
  assert.equal(r.role, 'Warehouse Associate');
});

test('"unfortunately we cannot respond to every applicant" in a confirmation is NOT a rejection', () => {
  const r = c('Target Careers <careers@target.com>', 'We received your application',
    'Thanks for applying to Target! Due to the high volume of applications, unfortunately we are not able to respond to every applicant individually. You can check your status anytime.');
  assert.equal(r.kind, 'application_received');
  assert.equal(r.company, 'Target');
  assert.equal(r.vendor, null, 'a corporate sender is not a vendor');
});

test('rejection: "decided to move forward with other candidates" beats the thank-you', () => {
  const r = c('Lever <no-reply@hire.lever.co>', 'Your application to Notion',
    'Hi Brandon,\n\nThank you for applying for the Product Designer position at Notion. After careful consideration, we have decided to move forward with other candidates whose experience more closely matches our needs.\n\nWe wish you the best in your search.');
  assert.equal(r.kind, 'rejection');
  assert.equal(r.company, 'Notion');
  assert.equal(r.role, 'Product Designer');
});

test('rejection variants: not selected, no longer under consideration, regret, position filled, will not be moving forward', () => {
  for (const line of [
    'We regret to inform you that you were not selected for this position.',
    'Your application is no longer under consideration.',
    'Unfortunately, we will not be moving forward with your application at this time.',
    'The position you applied for has been filled.',
    'We have decided not to proceed with your candidacy.',
    "Unfortunately, the hiring team has decided they won't be moving forward.",
  ]) assert.equal(detectKind('Update on your application', `Thank you for your interest. ${line}`), 'rejection', line);
});

test('Workday rejection from a tenant address: the company comes from the tenant', () => {
  const r = c('walmart@myworkday.com', 'Update regarding your application',
    'Dear Candidate,\nThank you for your interest. We have reviewed your application and have decided to pursue other candidates for this role.');
  assert.equal(r.kind, 'rejection');
  assert.equal(r.company, 'Walmart');
  assert.equal(r.vendor, 'Workday');
});

test('interview invite: phone screen depth, company from the sender name', () => {
  const r = c('Maria from Ramp Recruiting <maria@ramp.com>', 'Next steps',
    'Hi Brandon, thanks for applying! We would like to schedule a 30-minute phone screen with our recruiting team. Please pick a time that works for you using the link below.');
  assert.equal(r.kind, 'interview');
  assert.equal(r.stage, 'Phone Screen');
  assert.equal(r.company, 'Ramp');
});

test('interview invite variants and final-round depth', () => {
  assert.equal(detectKind('Interview Invitation - Software Engineer', 'Hello'), 'interview');
  assert.equal(detectKind('Next steps', 'We are excited to invite you to an onsite interview next week.'), 'interview');
  assert.equal(c('x@co.com', 'Your final round interview with Datadog', 'Your final round interview is scheduled for Monday.').stage, 'Final Round');
});

test('"excited to offer you an interview" is an interview, not an offer', () => {
  const r = c('Recruiting <jobs@figma.com>', 'Next steps at Figma', 'We are excited to offer you an interview for the Designer role. Please choose a time slot for your interview below.');
  assert.equal(r.kind, 'interview');
});

test('offer: offer letter / pleased to offer you the position', () => {
  assert.equal(detectKind('Your offer from Costco', 'We are pleased to offer you the Front End Assistant position at our Tempe warehouse.'), 'offer');
  assert.equal(detectKind('Congratulations!', 'Attached is your offer letter. Please review and sign by Friday.'), 'offer');
  assert.equal(detectKind('Benefits', 'We offer competitive pay and great benefits.'), null, '"we offer benefits" is not an offer');
});

test('assessment: online assessment / HackerRank; HireVue is a video interview', () => {
  const r = c('HackerRank <support@hackerrank.com>', 'Coding challenge from Robinhood', 'You have been invited to complete the coding assessment for Robinhood. The test takes about 90 minutes.');
  assert.equal(r.kind, 'assessment');
  assert.equal(r.vendor, 'HackerRank');
  const hv = c('HireVue <noreply@hirevue.com>', 'Complete your interview for Delta', 'Please complete the on-demand video assessment for Delta Air Lines within 5 days.');
  assert.equal(hv.kind, 'interview');
});

test('LinkedIn "your application was sent to": the board is never the company', () => {
  const r = c('LinkedIn <jobs-noreply@linkedin.com>', 'Brandon, your application was sent to Microsoft', 'Your application was sent to Microsoft\nSoftware Engineer II\nMicrosoft · Redmond, WA');
  assert.equal(r.kind, 'application_received');
  assert.equal(r.company, 'Microsoft');
  assert.equal(r.vendor, 'LinkedIn');
  assert.equal(r.vendorType, 'board');
});

test('Indeed application: role from the subject, company from "sent to"', () => {
  const r = c('Indeed Apply <indeedapply@indeed.com>', 'Indeed Application: Warehouse Associate',
    'Your application has been submitted. The following items were sent to Amazon. Good luck!');
  assert.equal(r.kind, 'application_received');
  assert.equal(r.role, 'Warehouse Associate');
  assert.equal(r.company, 'Amazon');
});

test('job alerts and digests change nothing', () => {
  assert.equal(c('LinkedIn <jobalerts-noreply@linkedin.com>', '30 new jobs for Account Executive', 'Jobs you may be interested in. Apply now.').kind, 'other');
  assert.equal(c('Indeed <alert@indeed.com>', 'Stripe is hiring', 'Thank you for using Indeed. New jobs near you').kind, 'other');
  assert.equal(c('Mom <mom@gmail.com>', 'Dinner sunday?', 'Let me know if you can make it').kind, 'other');
});

test('a hand-forwarded email is read from the employer, not from the user who forwarded it', () => {
  const r = c('Brandon <brandon@gmail.com>', 'Fwd: Your application to Costco',
    'FYI\n\n---------- Forwarded message ---------\nFrom: Costco Careers <careers@costco.com>\nDate: Mon, Oct 20, 2026 at 9:14 AM\nSubject: Your application to Costco\nTo: <brandon@gmail.com>\n\nThank you for applying for the Cashier position at Costco. We have received your application.');
  assert.equal(r.kind, 'application_received');
  assert.equal(r.company, 'Costco');
  assert.equal(r.role, 'Cashier');
  assert.equal(r.senderDomain, 'costco.com');
});

test('Gmail forwarding confirmation: the code and link are pulled out for the setup screen', () => {
  const r = c('Gmail Team <forwarding-noreply@google.com>', '(#123456789) Gmail Forwarding Confirmation - Receive Mail from brandon@gmail.com',
    'brandon@gmail.com has requested to automatically forward mail to your email address track-abc@seenjobs.io.\nConfirmation code: 123456789\nTo allow brandon@gmail.com to automatically forward mail to your address, please click the link below to confirm the request:\nhttps://mail-settings.google.com/mail/vf-%5BANGjdJ8abc%5D-xyz\n');
  assert.equal(r.kind, 'forwarding_confirm');
  assert.equal(r.forwardingConfirm.code, '123456789');
  assert.match(r.forwardingConfirm.url, /^https:\/\/mail-settings\.google\.com\/mail\/vf-/);
  assert.equal(r.forwardingConfirm.for, 'brandon@gmail.com');
});

test('HTML-only email: tags dropped, entities decoded once, style blocks ignored', () => {
  const html = '<html><head><style>.x{color:red}</style></head><body><p>Thank you for applying to <b>Chipotle&nbsp;Mexican Grill</b>!</p><p>We&#39;ve received your application for the Crew Member role.</p></body></html>';
  assert.equal(htmlToText(html), "Thank you for applying to Chipotle Mexican Grill!\n\nWe've received your application for the Crew Member role.");
  const r = classifyEmail({ from: 'Chipotle <chipotle@myworkday.com>', subject: 'Application received', html });
  assert.equal(r.kind, 'application_received');
  assert.equal(r.company, 'Chipotle Mexican Grill');
  assert.equal(r.role, 'Crew Member');
  assert.equal(htmlToText('&amp;lt;b&amp;gt;'), '&lt;b&gt;', 'decoded once, never twice');
});

test('a failed DKIM check lowers confidence one step', () => {
  const r = classifyEmail({ from: 'Stripe <no-reply@greenhouse.io>', subject: 'Thank you for applying to Stripe', text: 'We have received your application.', authentication: { dkim: 'fail' } });
  assert.equal(r.confidence, 'medium');
});

test('unwrapForward returns null for an ordinary email', () => {
  assert.equal(unwrapForward('Hello there\nThanks for applying'), null);
});
