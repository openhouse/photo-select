/**
 * Decide whether a completed level is terminal.
 *
 * Bucket presence is used instead of direct image counts because a prior
 * mixed level's kept photos may already have moved deeper into its `_keep`
 * subtree when a run resumes.
 */
export function evaluateLevelOutcome({
  complete,
  hasKeep,
  hasAside,
}) {
  if (!complete) {
    return { state: "incomplete", shouldStop: false };
  }

  if (hasKeep && hasAside) {
    return { state: "mixed", shouldStop: false };
  }

  if (hasKeep) {
    return { state: "unanimous_keep", shouldStop: true };
  }

  if (hasAside) {
    return { state: "unanimous_aside", shouldStop: true };
  }

  return { state: "empty", shouldStop: false };
}

export default evaluateLevelOutcome;
