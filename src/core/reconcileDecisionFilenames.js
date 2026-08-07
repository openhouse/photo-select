const SEMANTIC_TIMESTAMP = /^(\d{8}T\d{6})(\d+)Z(.*)$/;

function isTrailingZeroExpansion(returnedName, canonicalName) {
  const returned = returnedName.match(SEMANTIC_TIMESTAMP);
  const canonical = canonicalName.match(SEMANTIC_TIMESTAMP);
  if (!returned || !canonical) return false;

  const [, returnedSecond, returnedFraction, returnedSuffix] = returned;
  const [, canonicalSecond, canonicalFraction, canonicalSuffix] = canonical;
  if (returnedSecond !== canonicalSecond || returnedSuffix !== canonicalSuffix) {
    return false;
  }
  if (
    returnedFraction.length <= canonicalFraction.length ||
    !returnedFraction.startsWith(canonicalFraction)
  ) {
    return false;
  }
  return /^0+$/.test(returnedFraction.slice(canonicalFraction.length));
}

function parseJsonReply(rawReply) {
  const original = String(rawReply);
  const trimmed = original.trim();
  const fenced = trimmed.match(/^```(\w*)\n([\s\S]*?)\n```$/);
  const jsonText = fenced ? fenced[2] : trimmed;
  try {
    return {
      value: JSON.parse(jsonText),
      serialize(value) {
        const json = JSON.stringify(value);
        return fenced ? `\`\`\`${fenced[1]}\n${json}\n\`\`\`` : json;
      },
    };
  } catch {
    return null;
  }
}

export function reconcileDecisionFilenames(rawReply, allowedFilenames) {
  const parsed = parseJsonReply(rawReply);
  if (!parsed || !Array.isArray(parsed.value?.decisions)) {
    return { reply: rawReply, repairs: [] };
  }

  const allowed = [...new Set(allowedFilenames.map(String))];
  const allowedSet = new Set(allowed);
  const repairs = [];
  const decisions = parsed.value.decisions.map((decision) => {
    if (!decision || typeof decision !== "object") return decision;
    const returned = String(decision.filename || "").trim();
    if (!returned || allowedSet.has(returned)) return decision;

    const matches = allowed.filter((canonical) =>
      isTrailingZeroExpansion(returned, canonical)
    );
    if (matches.length !== 1) return decision;

    const canonical = matches[0];
    repairs.push({ returned, canonical });
    return { ...decision, filename: canonical };
  });

  if (!repairs.length) return { reply: rawReply, repairs };
  return {
    reply: parsed.serialize({ ...parsed.value, decisions }),
    repairs,
  };
}
