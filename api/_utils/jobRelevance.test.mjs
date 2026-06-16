// Tests for job relevance + company matching. Run: node --test api/_utils/jobRelevance.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relevanceScore, isRelated, looksLikeCompany, filterAndRank, tokenize } from './jobRelevance.js';

const J = (title, company, description = '') => ({ title, company, description, score: 65 });

test('unrelated listings score 0 and are dropped', () => {
  assert.equal(relevanceScore(J('Truck Driver', 'Acme Logistics'), 'react engineer'), 0);
  assert.equal(isRelated(J('Truck Driver', 'Acme Logistics'), 'react engineer'), false);
});

test('title matches rank above description matches', () => {
  const titleHit = relevanceScore(J('Senior React Engineer', 'X'), 'react engineer');
  const descHit = relevanceScore(J('Backend Developer', 'X', 'some react experience helpful'), 'react engineer');
  assert.ok(titleHit > descHit);
  assert.ok(descHit > 0);
});

test('empty query → everything related', () => {
  assert.equal(isRelated(J('Anything', 'AnyCo'), ''), true);
  assert.equal(relevanceScore(J('Anything', 'AnyCo'), ''), 1);
});

test('company-name query scores the company strongly', () => {
  const atCompany = relevanceScore(J('Software Engineer', 'Stripe'), 'stripe');
  const notCompany = relevanceScore(J('Software Engineer', 'Acme'), 'stripe');
  assert.ok(atCompany >= 60);
  assert.equal(notCompany, 0);
});

test('filterAndRank drops junk and orders by relevance', () => {
  const jobs = [
    J('Truck Driver', 'Acme'),                       // unrelated
    J('Backend Developer', 'Y', 'react a plus'),     // weak
    J('Senior React Engineer', 'Z'),                 // strong
  ];
  const out = filterAndRank(jobs, 'react engineer');
  assert.equal(out.length, 2);
  assert.equal(out[0].title, 'Senior React Engineer');
});

test('looksLikeCompany detects a company-name search', () => {
  const known = ['Stripe', 'Amazon', 'Google'];
  assert.equal(looksLikeCompany('stripe', known), true);
  assert.equal(looksLikeCompany('Amazon Inc', known), true);
  assert.equal(looksLikeCompany('react engineer', known), false);
  assert.equal(looksLikeCompany('stripe', undefined), false); // no list → can't assert
});

test('tokenize strips stop words and noise', () => {
  assert.deepEqual(tokenize('Jobs for a Senior Engineer near me'), ['senior', 'engineer']);
  assert.deepEqual(tokenize('C++ developer'), ['c++', 'developer']);
});

test('phrase bonus when full query is in the title', () => {
  const exact = relevanceScore(J('Data Scientist', 'X'), 'data scientist');
  const split = relevanceScore(J('Scientist of Data', 'X'), 'data scientist');
  assert.ok(exact > split);
});
