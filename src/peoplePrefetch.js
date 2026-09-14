import path from "node:path";
import { sanitizePeople } from "./lib/people.js";

const MAX_FILENAMES = 500;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

function peopleError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  if (status) error.status = status;
  return error;
}

function chunksOf(items, size = MAX_FILENAMES) {
  const chunks = [];
  for (let offset = 0; offset < items.length; offset += size) {
    chunks.push(items.slice(offset, offset + size));
  }
  return chunks;
}

function validatePayload(payload, requested, expectedCorpusSha256) {
  const corpusSha256 = payload?.meta?.corpusSha256;
  if (!HASH_PATTERN.test(corpusSha256 ?? "")) {
    throw peopleError(
      "PEOPLE_INDEX_INVALID_RESPONSE",
      "Photo Filter returned no valid people-index corpus identity",
    );
  }
  if (expectedCorpusSha256 && corpusSha256 !== expectedCorpusSha256) {
    throw peopleError(
      "PEOPLE_CORPUS_MISMATCH",
      "Photo Filter returned people metadata from a different corpus",
    );
  }
  if (!Array.isArray(payload?.data) || payload.data.length !== requested.length) {
    throw peopleError(
      "PEOPLE_INDEX_INVALID_RESPONSE",
      "Photo Filter returned an incomplete bulk people response",
    );
  }
  const byName = new Map();
  for (const item of payload.data) {
    if (!item || typeof item.filename !== "string" || byName.has(item.filename)) {
      throw peopleError(
        "PEOPLE_INDEX_INVALID_RESPONSE",
        "Photo Filter returned duplicate or invalid bulk people entries",
      );
    }
    byName.set(item.filename, sanitizePeople(item.people ?? []));
  }
  if (requested.some((filename) => !byName.has(filename))) {
    throw peopleError(
      "PEOPLE_INDEX_INVALID_RESPONSE",
      "Photo Filter omitted a requested filename from the bulk people response",
    );
  }
  return { corpusSha256, byName, meta: payload.meta };
}

export function createPeoplePrefetcher({
  fetchImpl = (...args) => globalThis.fetch(...args),
  apiBase,
  commitEntries,
  isDisabled = () => false,
} = {}) {
  let corpusSha256 = null;
  let bulkUnavailable = false;
  let forceConsumed = false;

  async function requestChunk(filenames, body) {
    let response;
    try {
      response = await fetchImpl(
        `${apiBase}/api/photos/by-filenames/persons`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...body, filenames }),
        },
      );
    } catch (error) {
      return {
        fallback: true,
        permanent: false,
        reason: error?.code ?? "network",
      };
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      /* validated below */
    }
    if (response.status === 404 || response.status === 405) {
      return {
        fallback: true,
        permanent: true,
        reason: `http-${response.status}`,
      };
    }
    if (!response.ok) {
      const code = payload?.errors?.[0]?.code ?? "PEOPLE_INDEX_HTTP_ERROR";
      throw peopleError(
        code,
        payload?.errors?.[0]?.detail ?? `Photo Filter HTTP ${response.status}`,
        response.status,
      );
    }
    return { payload };
  }

  async function run(filenames, { force = false } = {}) {
    const mode =
      force && !forceConsumed
        ? "force"
        : corpusSha256
          ? "snapshot"
          : "verify";
    let expected = mode === "snapshot" ? corpusSha256 : null;
    const staged = new Map();
    let lastMeta = null;
    const chunks = chunksOf(filenames);

    for (let index = 0; index < chunks.length; index += 1) {
      const refresh = index === 0 ? mode : "snapshot";
      const request = await requestChunk(chunks[index], {
        refresh,
        ...(expected ? { expectedCorpusSha256: expected } : {}),
      });
      if (request.fallback) return request;
      const validated = validatePayload(
        request.payload,
        chunks[index],
        expected,
      );
      expected = validated.corpusSha256;
      lastMeta = validated.meta;
      for (const entry of validated.byName) staged.set(...entry);
    }

    commitEntries(staged);
    corpusSha256 = expected;
    if (mode === "force") forceConsumed = true;
    return {
      mode: "bulk",
      names: filenames.length,
      chunks: chunks.length,
      corpusSha256,
      sourceCount: lastMeta?.sourceCount ?? 0,
      sourceFreshness: lastMeta?.sourceFreshness ?? "unknown",
      indexStatus: lastMeta?.indexStatus ?? "unknown",
    };
  }

  return {
    async prefetch(files, options = {}) {
      if (isDisabled()) return { mode: "disabled", names: 0, chunks: 0 };
      const filenames = [
        ...new Set(files.map((file) => path.basename(file))),
      ];
      if (filenames.length === 0) {
        return { mode: "empty", names: 0, chunks: 0 };
      }
      if (bulkUnavailable) {
        return { mode: "legacy-fallback", names: filenames.length, chunks: 0 };
      }
      try {
        const result = await run(filenames, options);
        if (result.fallback) {
          bulkUnavailable = result.permanent;
          return {
            mode: "legacy-fallback",
            names: filenames.length,
            chunks: 0,
            reason: result.reason,
          };
        }
        return result;
      } catch (error) {
        if (
          error?.status === 409 &&
          ["PEOPLE_INDEX_UNAVAILABLE", "PEOPLE_CORPUS_MISMATCH"].includes(
            error?.code,
          )
        ) {
          corpusSha256 = null;
          return run(filenames, options);
        }
        throw error;
      }
    },
  };
}
