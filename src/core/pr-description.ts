export type ReviewRow = Record<string, unknown>

function inlineCode(value: unknown): string {
  return `\`${String(value ?? '').replaceAll('`', '\\`')}\``
}

function changedFileRows(diff: string): Array<{ status: string; path: string }> {
  return diff.split('\n').filter(Boolean).map(line => {
    const [status = '?', ...paths] = line.split('\t')
    return { status, path: paths.at(-1) ?? '' }
  })
}

export function repairPrBody(input: {
  issueNumber: number
  issueTitle: string
  runner: string
  runId?: string
  diff: string
  commitCount: number
  tests: ReviewRow[]
  mergeMode?: 'review' | 'automatic'
}): string {
  const files = changedFileRows(input.diff)
  const passed = input.tests.filter(test => test.status === 'passing').length
  const testRows = input.tests.length
    ? input.tests.map(test => `- **${test.status === 'passing' ? 'PASS' : 'FAIL'}** — ${inlineCode(test.command)} (${inlineCode(test.path)})`).join('\n')
    : '- **NOT RUN** — no Issue-linked test.'
  const fileRows = files.length
    ? files.map(file => `- ${inlineCode(file.status)} ${inlineCode(file.path)}`).join('\n')
    : '- No changed files were detected.'
  const testsPassed = input.tests.length > 0 && passed === input.tests.length
  const automaticMerge = input.mergeMode === 'automatic'
  return `## Summary

Resolves local Issue #${input.issueNumber}: ${input.issueTitle}

${input.runner} prepared a focused repair on an isolated branch${input.runId ? ` in run ${inlineCode(input.runId)}` : ''}.

## What changed

- ${files.length} file${files.length === 1 ? '' : 's'} changed across ${input.commitCount} commit${input.commitCount === 1 ? '' : 's'}.
${fileRows}

## Validation

${testRows}

**Result: ${passed}/${input.tests.length} Issue-linked tests passed.**

## Effect

The linked reproduction ${testsPassed ? 'now passes on the repair branch' : 'has not yet been fully verified'}. ${automaticMerge
    ? 'The saved merge policy authorizes SkillHone to merge this local PR after all gates pass.'
    : 'The default branch is unchanged until the user approves this PR.'}

## Safety and review

- [${testsPassed ? 'x' : ' '}] All Issue-linked tests pass.
- [x] Changes are committed on an isolated local branch.
- [x] No push was performed.
${automaticMerge
    ? '- [x] The user selected automatic local merge during SkillHone configuration.\n- [x] Merge is allowed only after the linked tests pass.'
    : '- [x] No automatic merge was performed.\n- [ ] User reviewed the Issue, tests, commits, and changed files.\n- [ ] User approved the local merge.'}
`
}

export function benchmarkPrBody(input: {
  issueNumber: number
  evalCommit: string
  diff: string
  commitCount: number
  baseline: ReviewRow
  candidate: ReviewRow
  validationBaseline?: ReviewRow
  validationCandidate?: ReviewRow
  mergeMode?: 'review' | 'automatic'
}): string {
  const files = changedFileRows(input.diff)
  const fileRows = files.length
    ? files.map(file => `- ${inlineCode(file.status)} ${inlineCode(file.path)}`).join('\n')
    : '- No changed files were detected.'
  const delta = Number(input.candidate.score) - Number(input.baseline.score)
  const validation = input.validationBaseline && input.validationCandidate
    ? `- **PR validation:** ${input.validationBaseline.score} (${input.validationBaseline.n_passed}/${input.validationBaseline.n_total}) → ${input.validationCandidate.score} (${input.validationCandidate.n_passed}/${input.validationCandidate.n_total})`
    : ''
  const automaticMerge = input.mergeMode === 'automatic'
  return `## Summary

Resolves local Issue #${input.issueNumber} using frozen evaluation commit ${inlineCode(input.evalCommit.slice(0, 12))}.

DeepSeek Harness prepared a generalizable Skill improvement from the visible probe feedback without receiving the evaluation repository path or held-out evaluation data.

## What changed

- ${files.length} file${files.length === 1 ? '' : 's'} changed across ${input.commitCount} commit${input.commitCount === 1 ? '' : 's'}.
${fileRows}

## Evaluation effect

- **Probe:** ${input.baseline.score} (${input.baseline.n_passed}/${input.baseline.n_total}) → ${input.candidate.score} (${input.candidate.n_passed}/${input.candidate.n_total})
${validation}

Probe score change: ${delta >= 0 ? '+' : ''}${delta.toFixed(4)}. Probe questions were used only as reproducible optimization feedback; verifier code, gold answers, held-out inputs, and traces remain outside the Skill repository.

## Effect

The candidate passed the frozen evaluation gate. ${automaticMerge
    ? 'The saved merge policy authorizes SkillHone to merge this local PR after all gates pass.'
    : 'The default branch is unchanged until the user approves this PR.'}

## Safety and review

- [x] Evaluation data remained in the separate Eval repository.
- [x] The optimizer received probe questions and redacted aggregate feedback, but no verifier, gold answer, or held-out input.
- [x] No push was performed.
${automaticMerge
    ? '- [x] The user selected automatic local merge during SkillHone configuration.\n- [x] Merge is allowed only after the frozen evaluation gates pass.'
    : '- [x] No automatic merge was performed.\n- [ ] User reviewed the Issue, evaluation delta, commits, and changed files.\n- [ ] User approved the local merge.'}
`
}
