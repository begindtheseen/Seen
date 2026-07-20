import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEC_PHRASES, buildEdgarSearchUrl, cleanDisplayName, edgarFilingUrl,
  edgarHitToSignal, parseEdgarResponse,
} from './secEdgar.js';

const GROUP = SEC_PHRASES[0]; // reduction in force → layoff_disclosure / workforce reduction

// A real EFTS hit shape (captured live 2026-07).
const HIT = {
  _id: '0000768899-26-000018:a1q2026pressrelease.htm',
  _source: {
    ciks: ['0000768899'],
    display_names: ['TrueBlue, Inc.  (TBI)  (CIK 0000768899)'],
    file_date: '2026-05-05',
    form: '8-K',
    adsh: '0000768899-26-000018',
    biz_locations: ['Tacoma, WA'],
  },
};

test('buildEdgarSearchUrl quotes the phrase and scopes to 8-K + dates', () => {
  const u = buildEdgarSearchUrl('reduction in force', { startdt: '2026-01-01', enddt: '2026-07-20' });
  assert.match(u, /^https:\/\/efts\.sec\.gov\/LATEST\/search-index\?/);
  assert.match(u, /q=%22reduction\+in\+force%22/);
  assert.match(u, /forms=8-K/);
  assert.match(u, /startdt=2026-01-01/);
  assert.match(u, /enddt=2026-07-20/);
});

test('cleanDisplayName strips ticker + CIK parentheticals, keeps the legal name', () => {
  assert.equal(cleanDisplayName('TrueBlue, Inc.  (TBI)  (CIK 0000768899)'), 'TrueBlue, Inc.');
  assert.equal(cleanDisplayName('Autolus Therapeutics plc  (AUTL)  (CIK 0001730463)'), 'Autolus Therapeutics plc');
});

test('edgarFilingUrl builds the canonical sec.gov document link (CIK leading zeros stripped)', () => {
  assert.equal(
    edgarFilingUrl('0000768899', '0000768899-26-000018', 'a1q2026pressrelease.htm'),
    'https://www.sec.gov/Archives/edgar/data/768899/000076889926000018/a1q2026pressrelease.htm',
  );
  // no primary doc → the filing folder
  assert.equal(
    edgarFilingUrl('0000768899', '0000768899-26-000018', ''),
    'https://www.sec.gov/Archives/edgar/data/768899/000076889926000018/',
  );
  assert.equal(edgarFilingUrl('', '', ''), '');
});

test('edgarHitToSignal makes the MINIMAL true claim — references, never asserts the event', () => {
  const sig = edgarHitToSignal(HIT, GROUP);
  assert.equal(sig.company, 'TrueBlue, Inc.');
  assert.equal(sig.source, 'sec_8k');
  assert.equal(sig.event_type, 'layoff_disclosure');
  assert.equal(sig.event_date, '2026-05-05');
  assert.equal(sig.location, 'Tacoma, WA');
  assert.equal(sig.source_label, 'SEC 8-K filing');
  assert.equal(sig.source_url, 'https://www.sec.gov/Archives/edgar/data/768899/000076889926000018/a1q2026pressrelease.htm');
  assert.equal(sig.external_ref, 'sec:0000768899-26-000018:layoff_disclosure');
  // the safety-critical assertions: it says "references", never "did/announced layoffs"
  assert.match(sig.title, /references "workforce reduction"/);
  assert.doesNotMatch(`${sig.title} ${sig.detail}`, /\b(did|announced|confirmed|cut|fired|laid off)\b/i);
});

test('external_ref dedupes synonym phrases within one event_type but splits topics', () => {
  const a = edgarHitToSignal(HIT, SEC_PHRASES[0]); // reduction in force → layoff_disclosure
  const b = edgarHitToSignal(HIT, SEC_PHRASES[1]); // workforce reduction  → layoff_disclosure
  const c = edgarHitToSignal(HIT, SEC_PHRASES[3]); // restructuring plan   → restructuring_disclosure
  assert.equal(a.external_ref, b.external_ref);       // same filing + same event_type → one row
  assert.notEqual(a.external_ref, c.external_ref);    // different topic → distinct row
});

test('parseEdgarResponse maps a full response and drops unparseable hits', () => {
  const json = { hits: { hits: [HIT, { _id: 'x', _source: { display_names: [] } }, {}] } };
  const out = parseEdgarResponse(json, GROUP);
  assert.equal(out.length, 1);
  assert.equal(out[0].company, 'TrueBlue, Inc.');
});

test('parseEdgarResponse never throws on malformed input', () => {
  assert.deepEqual(parseEdgarResponse(null, GROUP), []);
  assert.deepEqual(parseEdgarResponse({}, GROUP), []);
  assert.deepEqual(parseEdgarResponse({ hits: {} }, GROUP), []);
});
