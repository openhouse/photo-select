import { describe, expect, it, vi } from "vitest";
import { finalizeCurators } from "../src/core/finalizeCurators.js";
import { createPeoplePrefetcher } from "../src/peoplePrefetch.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function successFor(body, corpusSha256 = HASH_A) {
  return jsonResponse({
    data: body.filenames.map((filename) => ({
      filename,
      resolvedFilename: filename,
      status: "exact",
      people: filename.startsWith("shared-") ? ["Alice"] : [filename],
    })),
    meta: {
      schemaVersion: 1,
      corpusSha256,
      sourceCount: 2,
      indexStatus: body.refresh === "snapshot" ? "snapshot" : "rebuilt",
      sourceFreshness: "unknown",
    },
  });
}

describe("people metadata bulk prefetch", () => {
  it("chunks 1,001 names and pins every later chunk to one corpus", async () => {
    const requests = [];
    const cache = new Map();
    const fetchImpl = vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      return successFor(body);
    });
    const prefetcher = createPeoplePrefetcher({
      fetchImpl,
      apiBase: "http://photo-filter.test",
      commitEntries(entries) {
        for (const [filename, people] of entries) cache.set(filename, people);
      },
    });
    const filenames = Array.from({ length: 1001 }, (_, i) => `P${i}.jpg`);

    const result = await prefetcher.prefetch(filenames);

    expect(requests.map((body) => body.filenames.length)).toEqual([500, 500, 1]);
    expect(requests[0]).toMatchObject({ refresh: "verify" });
    expect(requests.slice(1)).toEqual(
      requests.slice(1).map((body) => ({
        ...body,
        refresh: "snapshot",
        expectedCorpusSha256: HASH_A,
      })),
    );
    expect(cache).toHaveLength(1001);
    expect(result).toMatchObject({
      mode: "bulk",
      names: 1001,
      chunks: 3,
      corpusSha256: HASH_A,
      sourceFreshness: "unknown",
    });

    await prefetcher.prefetch(["P0.jpg"]);
    expect(requests[3]).toMatchObject({
      refresh: "snapshot",
      expectedCorpusSha256: HASH_A,
    });
  });

  it("commits no partial cache when chunk corpus identities differ", async () => {
    const commitEntries = vi.fn();
    let request = 0;
    const prefetcher = createPeoplePrefetcher({
      fetchImpl: vi.fn(async (_url, options) => {
        const body = JSON.parse(options.body);
        request += 1;
        return successFor(body, request === 1 ? HASH_A : HASH_B);
      }),
      apiBase: "http://photo-filter.test",
      commitEntries,
    });
    const filenames = Array.from({ length: 501 }, (_, i) => `P${i}.jpg`);

    await expect(prefetcher.prefetch(filenames)).rejects.toMatchObject({
      code: "PEOPLE_CORPUS_MISMATCH",
    });
    expect(commitEntries).not.toHaveBeenCalled();
  });

  it("falls back lazily and remembers when the bulk capability is absent", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ errors: [{ detail: "Not Found" }] }, 404),
    );
    const commitEntries = vi.fn();
    const prefetcher = createPeoplePrefetcher({
      fetchImpl,
      apiBase: "http://photo-filter.test",
      commitEntries,
    });

    expect(await prefetcher.prefetch(["A.jpg"])).toMatchObject({
      mode: "legacy-fallback",
    });
    expect(await prefetcher.prefetch(["B.jpg"])).toMatchObject({
      mode: "legacy-fallback",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(commitEntries).not.toHaveBeenCalled();
  });

  it("preserves the repeated-person curator rule with bulk results", async () => {
    const cache = new Map();
    const prefetcher = createPeoplePrefetcher({
      fetchImpl: vi.fn(async (_url, options) =>
        successFor(JSON.parse(options.body)),
      ),
      apiBase: "http://photo-filter.test",
      commitEntries(entries) {
        for (const [filename, people] of entries) cache.set(filename, people);
      },
    });

    await prefetcher.prefetch(["shared-a.jpg", "shared-b.jpg", "solo.jpg"]);
    const finalized = finalizeCurators(
      ["Base Curator"],
      [...cache].map(([file, people]) => ({ file, people })),
    );

    expect(finalized.finalCurators).toEqual(["Base Curator", "Alice"]);
    expect(finalized.added).toEqual(["Alice"]);
  });

  it("recovers from a restarted server by verifying the full level again", async () => {
    const requests = [];
    const commitEntries = vi.fn();
    let call = 0;
    const prefetcher = createPeoplePrefetcher({
      fetchImpl: vi.fn(async (_url, options) => {
        const body = JSON.parse(options.body);
        requests.push(body);
        call += 1;
        if (call === 2) {
          return jsonResponse(
            { errors: [{ code: "PEOPLE_INDEX_UNAVAILABLE", detail: "restart" }] },
            409,
          );
        }
        return successFor(body, call === 1 ? HASH_A : HASH_B);
      }),
      apiBase: "http://photo-filter.test",
      commitEntries,
    });

    await prefetcher.prefetch(["A.jpg"]);
    const recovered = await prefetcher.prefetch(["B.jpg"]);

    expect(requests.map(({ refresh }) => refresh)).toEqual([
      "verify",
      "snapshot",
      "verify",
    ]);
    expect(recovered.corpusSha256).toBe(HASH_B);
    expect(commitEntries).toHaveBeenCalledTimes(2);
  });

  it("forces one refresh, then reuses the pinned snapshot", async () => {
    const requests = [];
    const prefetcher = createPeoplePrefetcher({
      fetchImpl: vi.fn(async (_url, options) => {
        const body = JSON.parse(options.body);
        requests.push(body);
        return successFor(body);
      }),
      apiBase: "http://photo-filter.test",
      commitEntries() {},
    });

    await prefetcher.prefetch(["A.jpg"], { force: true });
    await prefetcher.prefetch(["B.jpg"], { force: true });
    expect(requests.map(({ refresh }) => refresh)).toEqual(["force", "snapshot"]);
  });

  it("retries bulk discovery after a transient network fallback", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("reset"), { code: "ECONNRESET" }))
      .mockImplementationOnce(async (_url, options) =>
        successFor(JSON.parse(options.body)),
      );
    const prefetcher = createPeoplePrefetcher({
      fetchImpl,
      apiBase: "http://photo-filter.test",
      commitEntries() {},
    });

    expect(await prefetcher.prefetch(["A.jpg"])).toMatchObject({
      mode: "legacy-fallback",
    });
    expect(await prefetcher.prefetch(["B.jpg"])).toMatchObject({ mode: "bulk" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
