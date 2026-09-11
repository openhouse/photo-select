# Preserving Photo Select when extending GitHub access

`--github-all` adds authenticated read-only tools to the existing curation request.
The default and custom prompts, full context, photo metadata, curator rules,
output placement and resume behavior remain the caller's existing workflow.
Changes to those behaviors need their own explicit scope and review.

## Eval audit: 2026-09-11

### Evaluator design: shared reference blind spot

**Status: corrected.** The prompt-parity tests compared the GitHub request with
`buildPrompt` and the current template. A shared change could pass both sides.
`tests/fixtures/pre-github-default-prompt.hbs` now preserves the original template
from `f7a5a01dfc7badddbec9841df91a24d88d11d27c`. A pinned SHA-256 protects the
fixture; an independent test renderer checks actual requests against it. It does
not call the production renderer. Unrequested default template changes fail even when both ordinary and GitHub
paths change together. The 2026-09-11 user-authorized conditional GitHub invitation
is the sole allowed delta, with a separate literal test reference; the historical
fixture stays unchanged.

### Pipeline hygiene: cached CLI coverage

**Status: corrected.** Existing CLI parity cases used short briefs. New cases
exercise default, custom and inline context with a cacheable brief across seed,
probe and reader curations. They require historical instructions plus only the authorized invitation when
applicable, one copy
of the brief, changing filenames after a stable cache prefix, tagged curators,
image metadata, tool attachment, progress output and source-directory sorting.
External API and tunnel boundaries are synthetic in these tests.

### Reliability: isolated cache misses

**Status: repaired in deterministic evals; live recovery pending.** An actual
mixed reader wave had seven confirmed hits and one zero report with identical
stable request hashes. The immediate-stop test encoded the old policy instead
of testing continuity. The updated scheduler preserves completed work, then
checks the next unprocessed batch serially, with at most two recovery batches.
Only confirmed reuse releases parallel work. Tests retain startup, missing-usage,
transport, tier and cancellation holds and require exactly one curation per
image batch. An 84-batch CLI case includes both early and late cache misses.

### Human review and live evidence

**Status: still bounded.** The suite checks implementation contracts, not whether
an edit is artistically useful. Small live canaries establish only the operations
and load they actually exercise. Full-corpus completion, installed-command
acceptance and editorial review must retain their own evidence. A successful tool
status alone is insufficient evidence that source text reached the model.
The [readiness record](../evals/github-inference-readiness.json) keeps these scopes
separate. No LLM judge or aggregate quality score decides these binary contracts.

## Behavioral contract and evidence

| Contract | Deterministic evidence | Limit |
| --- | --- | --- |
| Original prompt and substitutions survive except the authorized invitation | `githubOriginalContract.test.js`, `githubPromptParity.test.js` | Historical compatibility, not editorial quality |
| Conditional invitation follows context links only | `githubContextPrompt.test.js`, `githubOriginalContract.test.js` | Invitation presence does not prove exploration |
| Default/custom/inline context survives caching | `cliGithubWorkflow.test.js` | Synthetic API usage; live cache evidence stays separate |
| Existing curator additions and metadata survive | `cliGithubWorkflow.test.js`, `githubCuration.test.js` | Fictional output fixtures |
| Results sort in the selected directory and resume | `cliGithubWorkflow.test.js` | Temporary synthetic photographs |
| Credential and discovery failures are classified | `githubBridge.test.js`, `githubReliability.test.js`, `githubFlex.test.js` | Injected faults; no promise against all service outages |
| Isolated cache misses use bounded serial recovery | `githubCacheRecovery.test.js`, `githubPromptCache.test.js`, 84-batch `cliGithubWorkflow.test.js` | Synthetic usage cannot guarantee provider cache availability |
| Presentation targets do not discard valid work | `githubCuration.test.js`, 84-batch `cliGithubWorkflow.test.js` | Length warnings do not measure editorial usefulness |
| Private source text reaches the model | Version-bound live receipts | Only the tested sources and requests |
| The full photographic job completes | A completed run and reconciled output counts | Never inferred from a seed, cache hit or test count |

## Development sequence

1. State the requested behavior and preservation requirements before editing.
   Reuse the current rendering, roster, sorting and caching components. Distinguish
   structural and credential requirements from presentation targets: a length
   deviation should be reported without discarding valid work or buying a repair.
2. Add an assertion at the affected boundary. Keep historical expected values
   independent of the code being changed. Deliberately reintroduce the fault in
   a disposable copy to demonstrate that the assertion fails.
3. Run the focused cases, then `npm run hillclimb` and `git diff --check`.
   The focused report hashes the candidate and rejects changes during evaluation.
4. When application or transport code changes, live acceptance can use the installed
   command with synthetic images, then a representative full-context canary. Jamie
   currently requires curation runs to be started in their Terminal; do not launch
   background curation or a paid canary. Mark prior evidence as historical when its
   implementation hashes no longer match, and report live acceptance as pending.
   Verify delivered source text, returned usage, sorting and recovery before scaling up. Reuse a
   live receipt only while its implementation hashes still match.
5. Update the PR with the behavior, validation scope and remaining limits. Verify
   hosted CI on the final commit. Report startup, bounded acceptance and full-run
   completion separately.

Do not refresh the frozen fixture merely to turn a failure green. An intentional
prompt change needs the user's requested scope, a visible prompt diff and a
separately reviewed delta to the independent reference. Do not change the running application while injecting faults;
use a disposable copy, and retain completed photo selections during recovery.
