#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { copyFile } from "../src/fs/copyOps.js";

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "apfs-clone-test-"));
  const src = path.join(dir, "source.bin");
  const dst = path.join(dir, "dest.bin");
  await fs.writeFile(src, Buffer.alloc(1024, 7));
  const result = await copyFile(src, dst, process.env.COPY_STRATEGY || "auto");
  const st = await fs.stat(dst);
  console.log(JSON.stringify({ mode: result.mode, bytes: st.size }));
  await fs.rm(dir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err?.message || String(err) }));
  process.exitCode = 1;
});
