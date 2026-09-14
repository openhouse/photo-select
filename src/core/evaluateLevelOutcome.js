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
  levelSize,
  targetLevelSize,
}) {
  if (!complete) {
    return { state: "incomplete", shouldStop: false };
  }

  const hasTarget =
    Number.isInteger(targetLevelSize) && targetLevelSize > 0;
  const hasKnownLevelSize = Number.isInteger(levelSize) && levelSize >= 0;

  if (
    hasTarget &&
    hasKnownLevelSize &&
    levelSize <= targetLevelSize
  ) {
    return { state: "target_reached", shouldStop: true };
  }

  if (hasKeep && hasAside) {
    return { state: "mixed", shouldStop: false };
  }

  if (hasKeep) {
    const shouldContinueTowardTarget =
      hasTarget && hasKnownLevelSize && levelSize > targetLevelSize;
    return {
      state: "unanimous_keep",
      shouldStop: !shouldContinueTowardTarget,
    };
  }

  if (hasAside) {
    return { state: "unanimous_aside", shouldStop: true };
  }

  return { state: "empty", shouldStop: false };
}

export default evaluateLevelOutcome;
