<<<<<<< HEAD
import { mkdtemp, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execa } from "execa";

async function main() {
  const dir = await mkdtemp(path.join(tmpdir(), "apfs-clone-test-"));
  const src = path.join(dir, "source.bin");
  const dst = path.join(dir, "clone.bin");
  await writeFile(src, randomBytes(16 * 1024));
  try {
    await execa(path.resolve("bin/apfs-clone"), [src, dst]);
    const a = await stat(src);
    const b = await stat(dst);
    console.log(JSON.stringify({ ok: true, size: a.size, cloneSize: b.size }));
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }));
    process.exitCode = 1;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
=======
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
>>>>>>> 0ae3a4d44102f9c967930a22cba4020805285663
});
