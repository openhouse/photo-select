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
});
