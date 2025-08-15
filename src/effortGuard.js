export const RANK = { minimal: 0, low: 1, medium: 2, high: 3 };

export function enforceEffortGuard(requestEffort) {
  const user = process.env.PHOTO_SELECT_USER_EFFORT || "minimal";
  if (RANK[requestEffort] < RANK[user]) {
    throw new Error(`EffortGuard: requested ${requestEffort} < user ${user}`);
  }
}
