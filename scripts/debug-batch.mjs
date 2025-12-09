import OpenAI from "openai";
import fs from "node:fs/promises";
import path from "node:path";

let openai;

function getClient() {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY not set");
    }
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

const pretty = (x) => JSON.stringify(x, null, 2);
const safeParse = (line) => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};
const countBy = (arr) =>
  arr.reduce((acc, k) => ((acc[k] = (acc[k] || 0) + 1), acc), {});

async function fetchTextFile(fileId) {
  const client = getClient();
  const res = await client.files.content(fileId);
  return await res.text();
}

async function saveToTmp(name, text) {
  const out = path.join("/tmp", name);
  await fs.writeFile(out, text, "utf8");
  return out;
}

async function peekJsonl(text, n = 10) {
  const lines = text.trim().split("\n").filter(Boolean);
  const first = lines.slice(0, n).map(safeParse).filter(Boolean);
  return { totalLines: lines.length, first };
}

function extractError(row) {
  let err = row?.error || null;
  if (!err && row?.response?.body) {
    try {
      const body =
        typeof row.response.body === "string"
          ? JSON.parse(row.response.body)
          : row.response.body;
      if (body?.error) {
        err = body.error;
      }
    } catch {
      // ignore parse errors
    }
  }
  return err;
}

function logErrorRow(row) {
  const cid = row.custom_id ?? "(no custom_id)";
  const err = extractError(row) || {};
  const code = err.code ?? err.type ?? "unknown";
  const msg = err.message ?? "(no message)";
  const param = err.param ? ` param=${err.param}` : "";
  console.error(`  • ${cid}: [${code}] ${msg}${param}`);
  if ((code === "unknown" || msg === "(no message)") && (row.error || row.response)) {
    console.error(
      "    raw error object:",
      JSON.stringify(row.error ?? row.response, null, 2)
    );
  }
}

export async function debugBatch(batchId, { peek = 10 } = {}) {
  console.error(`🔎 Debugging batch ${batchId} …`);
  const client = getClient();
  const b = await client.batches.retrieve(batchId);

  console.error("📋 Batch status:");
  console.error(pretty({
    id: b.id,
    status: b.status,
    created_at: b.created_at,
    completion_window: b.completion_window,
    request_counts: b.request_counts,
    metadata: b.metadata,
    model: b.metadata?.model ?? b.default_model ?? "(unknown)",
    input_file_id: b.input_file_id,
    output_file_id: b.output_file_id,
    error_file_id: b.error_file_id
  }));

  try {
    const inputText = await fetchTextFile(b.input_file_id);
    const inputLines = inputText.trim().split("\n").filter(Boolean);
    console.error(`📥 Input JSONL: ${inputLines.length} line(s).`);
    if (inputLines.length) {
      const firstTwo = inputLines.slice(0, 2).join("\n");
      console.error("  First 2 line(s):\n" + firstTwo);
    }
  } catch (e) {
    console.error("⚠️ Could not fetch input_file_id content:", e.message || e);
  }

  if (b.error_file_id) {
    const errText = await fetchTextFile(b.error_file_id);
    const errPath = await saveToTmp(`batch-${b.id}-errors.jsonl`, errText);
    console.error(`🧾 Saved error JSONL → ${errPath}`);
    const { totalLines, first } = await peekJsonl(errText, peek);

    const errorCodes = countBy(
      first.map((r) => {
        const err = extractError(r);
        return err?.code ?? err?.type ?? "unknown";
      })
    );
    console.error(`❗ ${totalLines} error row(s). Summary by code/type:`);
    Object.entries(errorCodes).forEach(([k, v]) =>
      console.error(`  - ${k}: ${v}`)
    );

    console.error(`🔬 First ${first.length} error row(s):`);
    first.forEach(logErrorRow);
  } else {
    console.error("ℹ️ No error_file_id on this batch.");
  }

  if (b.output_file_id) {
    const outText = await fetchTextFile(b.output_file_id);
    const outPath = await saveToTmp(`batch-${b.id}-output.jsonl`, outText);
    console.error(`✅ Saved output JSONL → ${outPath}`);
    const { totalLines, first } = await peekJsonl(outText, peek);
    console.error(`📤 ${totalLines} success row(s). Showing first ${first.length}:`);
    first.forEach((r, i) =>
      console.error(`  • [${i + 1}] ${r?.custom_id ?? "(no custom_id)"}`)
    );
  } else {
    console.error("ℹ️ No output_file_id on this batch.");
  }

  if (!b.output_file_id && !b.error_file_id) {
    console.error("⚠️ Completed without output **and** without an error file.");
    console.error(
      "   This usually means the input JSONL was empty/invalid, or every request was rejected before execution."
    );
    console.error(
      "   The input peek above should confirm whether we actually uploaded valid request rows."
    );
  }
}

if (process.argv[1] && process.argv[1].endsWith("debug-batch.mjs")) {
  const batchId = process.argv[2];
  if (!batchId) {
    console.error("Usage: node scripts/debug-batch.mjs <batchId>");
    process.exit(2);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY not set");
    process.exit(1);
  }
  debugBatch(batchId).catch((e) => {
    console.error("❌ debugBatch failed:", e);
    process.exit(1);
  });
}
