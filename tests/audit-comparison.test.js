import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareAudits
} from '../src/audit-comparison.js';

const audit = (overrides = {}) => ({
  auditId: 'audit',
  status: 'completed',
  score: 80,
  qualityGate: { passed: true },
  profile: 'standard',
  selectedChecks: ['manifest'],
  applicationId: 'example.com',
  url: 'https://example.com/',
  versions: { engineVersion: '1', rulesetVersion: 'a' },
  ...overrides
});

test('classifies stable check IDs without mutating source payloads', () => {
  const baselineResults = {
    terminal: true,
    results: [
      { check: 'b', status: 'failed' },
      { check: 'c', status: 'passed' },
      { check: 'd', status: 'warning' },
      { check: 'removed', status: 'passed' }
    ]
  };
  const candidateResults = {
    terminal: true,
    results: [
      { check: 'a', status: 'passed' },
      { check: 'b', status: 'passed' },
      { check: 'c', status: 'error' },
      { check: 'd', status: 'blocked' }
    ]
  };
  const original = structuredClone({ baselineResults, candidateResults });
  const result = compareAudits({
    baselineAudit: audit({ score: null, qualityGate: {} }),
    baselineResults,
    candidateAudit: audit({ auditId: 'candidate' }),
    candidateResults
  });

  assert.equal(result.scoreChange, null);
  assert.equal(result.resolved[0].check, 'b');
  assert.equal(result.newProblems[0].check, 'c');
  assert.equal(result.persistentProblems[0].check, 'd');
  assert.deepEqual(result.addedChecks.map(({ check }) => check), ['a']);
  assert.deepEqual(result.removedChecks.map(({ check }) => check), ['removed']);
  assert.deepEqual({ baselineResults, candidateResults }, original);
});

test('marks incomplete and incompatible comparisons with warnings', () => {
  const result = compareAudits({
    baselineAudit: audit({ status: 'running', profile: 'standard' }),
    baselineResults: { terminal: false, results: [{ check: 'manifest', status: 'future' }] },
    candidateAudit: audit({
      auditId: 'candidate',
      profile: 'full',
      selectedChecks: ['offline'],
      applicationId: 'other.example.com',
      url: 'https://other.example.com/',
      versions: { engineVersion: '2', rulesetVersion: 'b' }
    }),
    candidateResults: { terminal: true, results: [{ check: 'manifest', status: 'passed' }] }
  });

  assert.equal(result.comparisonComplete, false);
  assert.equal(result.statusChanges[0].check, 'manifest');
  assert.ok(result.warnings.some((warning) => warning.includes('not terminal')));
  assert.ok(result.warnings.some((warning) => warning.includes('different profiles')));
  assert.ok(result.warnings.some((warning) => warning.includes('unknown status')));
});
