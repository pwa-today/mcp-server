const problemStatuses = new Set([
  'failed',
  'warning',
  'blocked',
  'error'
]);
const knownStatuses = new Set([
  ...problemStatuses,
  'passed',
  'not-applicable',
  'skipped'
]);
const terminalStatuses = new Set([
  'completed',
  'partially-completed',
  'failed'
]);

const nullableBoolean = (value) => typeof value === 'boolean' ? value : null;
const comparableArray = (value) => Array.isArray(value) ? [...value].sort() : [];
const sameArray = (left, right) => JSON.stringify(comparableArray(left)) === JSON.stringify(comparableArray(right));

const auditSummary = (audit) => ({
  auditId: audit.auditId,
  status: audit.status,
  score: audit.score ?? null,
  qualityGatePassed: nullableBoolean(audit.qualityGate?.passed),
  profile: audit.profile ?? null,
  selectedChecks: audit.selectedChecks ?? [],
  versions: audit.versions ?? {},
  applicationId: audit.applicationId ?? null,
  url: audit.url ?? null
});

export const compareAudits = ({
  baselineAudit,
  baselineResults,
  candidateAudit,
  candidateResults
}) => {
  const warnings = [];
  const baseline = auditSummary(baselineAudit);
  const candidate = auditSummary(candidateAudit);
  const comparisonComplete = terminalStatuses.has(baseline.status) && terminalStatuses.has(candidate.status) && baselineResults.terminal === true && candidateResults.terminal === true;

  if (!comparisonComplete) {
    warnings.push('One or both audits are not terminal, so this comparison may change.');
  }
  if (baseline.profile !== candidate.profile) {
    warnings.push('The audits use different profiles.');
  }
  if (!sameArray(baseline.selectedChecks, candidate.selectedChecks)) {
    warnings.push('The audits use different selected checks.');
  }
  if (baseline.versions.rulesetVersion !== candidate.versions.rulesetVersion) {
    warnings.push('The audits use different ruleset versions.');
  }
  if (baseline.versions.engineVersion !== candidate.versions.engineVersion) {
    warnings.push('The audits use different engine versions.');
  }
  if (baseline.applicationId !== candidate.applicationId) {
    warnings.push('The audits are for different applications.');
  }
  if (baseline.url !== candidate.url) {
    warnings.push('The audits use different URLs.');
  }

  const baselineByCheck = new Map((baselineResults.results ?? []).map((result) => [result.check, result]));
  const candidateByCheck = new Map((candidateResults.results ?? []).map((result) => [result.check, result]));
  const comparison = {
    baseline,
    candidate,
    comparisonComplete,
    scoreChange: baseline.score === null || candidate.score === null ? null : candidate.score - baseline.score,
    qualityGateChange: {
      previous: baseline.qualityGatePassed,
      current: candidate.qualityGatePassed
    },
    resolved: [],
    newProblems: [],
    persistentProblems: [],
    statusChanges: [],
    addedChecks: [],
    removedChecks: [],
    unchanged: [],
    warnings
  };

  [...new Set([...baselineByCheck.keys(), ...candidateByCheck.keys()])]
    .sort()
    .forEach((check) => {
      const previous = baselineByCheck.get(check);
      const current = candidateByCheck.get(check);

      if (!previous) {
        comparison.addedChecks.push(current);
        return;
      }
      if (!current) {
        comparison.removedChecks.push(previous);
        return;
      }
      if (!knownStatuses.has(previous.status) || !knownStatuses.has(current.status)) {
        warnings.push(`Check ${check} has an unknown status and was not classified as a success or problem.`);
      }

      const previousProblem = problemStatuses.has(previous.status);
      const currentProblem = problemStatuses.has(current.status);
      const changed = previous.status !== current.status;
      const change = {
        check,
        previousStatus: previous.status,
        currentStatus: current.status,
        previous,
        current
      };

      if (previousProblem && !currentProblem) {
        comparison.resolved.push(change);
      }
      else if (!previousProblem && currentProblem) {
        comparison.newProblems.push(change);
      }
      else if (previousProblem && currentProblem) {
        comparison.persistentProblems.push(change);
      }
      else if (changed) {
        comparison.statusChanges.push(change);
      }
      else {
        comparison.unchanged.push(check);
      }
    });

  return comparison;
};

export const comparisonSummary = (comparison) => {
  const score = comparison.scoreChange === null
    ? 'Candidate score is pending.'
    : `Candidate score ${comparison.scoreChange >= 0 ? 'improved' : 'declined'} by ${Math.abs(comparison.scoreChange)} points.`;
  const qualityGate = comparison.qualityGateChange.previous === null || comparison.qualityGateChange.current === null
    ? 'Quality gate is pending.'
    : `Quality gate changed from ${comparison.qualityGateChange.previous ? 'passed' : 'failed'} to ${comparison.qualityGateChange.current ? 'passed' : 'failed'}.`;
  const findings = `${comparison.resolved.length} problems resolved, ${comparison.newProblems.length} new problems, and ${comparison.persistentProblems.length} persistent problems.`;

  return `${score} ${qualityGate} ${findings} Comparison is ${comparison.comparisonComplete ? 'complete' : 'not complete'}.${comparison.warnings[0] ? ` ${comparison.warnings[0]}` : ''}`;
};
