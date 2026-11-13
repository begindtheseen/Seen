// Run: node --test lib/jobs/trainsBeginners.test.mjs
// Sentences are from real postings read 2026-11-13 (research: oilfield.md §1, resume-hiring-side.md §4) unless
// marked otherwise; the duty lines are the false positives the old bare "will train" read as an offer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trainsBeginners, postingSaysEntryLevel, listingTrainsBeginners } from './trainsBeginners.js';
import { listingLevel, inferLevel } from '../server/jobSources.js';
import { saysEntryLevel } from '../server/jobKeys.js';

test('real entry postings read as training beginners', () => {
  for (const s of [
    'This is an entry-level job that provides initial introductory training and substantial on-the-job training.', // Patterson-UTI floorhand
    'Oilfield experience preferred but not required. Must be dependable, punctual, and willing to work.', // Javelina roustabout
    'Previous oilfield, construction, farm, ranch, or outdoor labor experience is helpful but not required.', // James Oilwell
    'Prior experience in oil & gas operations or construction sites is preferred but not mandatory; willingness to learn is essential.', // casing floorhand
    'Diesel Technician Apprentice-Paid Training', // Republic Services title
    'No experience necessary.', 'No experience required — we will train the right candidate.', 'No experience? No problem!',
    'Will train.', 'We\'ll train you on every piece of equipment.', 'Company-paid CDL training for new drivers.',
    'Join our registered apprenticeship program.', 'Earn while you learn.', 'Green hands welcome.',
    'Car wash experience is a plus, but not required—we’ll train the right person!', // a production row
    'In this exciting role, we provide full training in phlebotomy (blood drawing).', // a production row
  ]) assert.equal(trainsBeginners(s), true, s);
});

test('duty lines and experience demands are not a training offer', () => {
  for (const s of [
    'You will train new associates on store procedures.', 'Supervisors will train and develop the crew.',
    'Provides training to new employees.', 'Candidates with no experience will not be considered.',
    'Must have a minimum of 1 year of experience as a workover rig Floor Hand.', // Shebester Bechtel
    '3+ years of experience as an Electrician/Electrical Apprentice', // Power Design "Electrical Trainee"
    'Non-entry-level positions require a minimum of six months of prior drilling experience.', // H&P (no offer)
    // production rows the first draft misread:
    'Crew Mentorship: Onboard and provide hands-on training for new installation crews.',
    'training will be provided for organization-specific systems', // a coordinator learning the office's software
    'Preferred: Completion of a recognized pipefitter apprenticeship program.',
    'Journeyman lineman certification from a recognized U.S. Department of Labor (DOL) apprenticeship program',
    '2+ years of HVAC experience. Property management experience is a plus but not required.',
    '',
  ]) assert.equal(trainsBeginners(s), false, s);
  // "entry level" alone is entry level for the matched-jobs reader, not a training offer
  assert.equal(postingSaysEntryLevel({ title: 'Yard Hand', description: 'Entry level role in our Midland yard.' }), true);
  assert.equal(trainsBeginners('Entry level role in our Midland yard.'), false);
});

test('a listing that trains beginners is Entry level even when its title says nothing; the title wins otherwise', () => {
  const floorhand = { title: 'Floorhand - South and East Texas', description: 'This is an entry-level job that provides initial introductory training and substantial on-the-job training.' };
  assert.equal(inferLevel(floorhand.title), '');
  assert.equal(listingLevel(floorhand.title, floorhand.description), 'Entry level');
  assert.equal(listingTrainsBeginners(floorhand), true);
  // no offer in the posting → unchanged
  assert.equal(listingLevel('Workover Rig Hand', 'Must have a minimum of 1 year of experience as a workover rig Floor Hand.'), '');
  // a title above a beginner (or teaching the work) never becomes Entry level / never carries the flag
  for (const title of ['Floorhand (Experienced) - Permian Basin', 'Electrical Apprenticeship Instructor', 'Lead Welder', 'Mechanic II', 'Rig Manager']) {
    assert.equal(listingTrainsBeginners({ title, description: 'Paid training. Apprenticeship program.' }), false, title);
    assert.notEqual(listingLevel(title, 'Paid training.'), 'Entry level', title);
  }
  // title behaviour is unchanged for every title that already names a level
  assert.equal(listingLevel('Senior Lease Operator', 'Will train.'), 'Senior');
  assert.equal(listingLevel('Cashier', ''), 'Entry level');
  assert.equal(listingLevel('Accountant', ''), '');
});

test('jobKeys.saysEntryLevel reads the same definition', () => {
  assert.equal(saysEntryLevel({ title: 'Roustabout Hand', description: 'Oilfield experience preferred but not required.' }), true);
  assert.equal(saysEntryLevel({ title: 'Entry Level Oilfield Operator', description: '' }), true);
  assert.equal(saysEntryLevel({ title: 'Shift Lead', description: 'You will train new associates.' }), false);
});
