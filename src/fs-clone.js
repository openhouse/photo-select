import * as fsp from "node:fs/promises";
import { constants as FSC } from "node:fs";

export async function copyFilePreferClone(src, dest, { overwrite = true } = {}) {
  const mode = FSC.COPYFILE_FICLONE;
  try {
    await fsp.copyFile(src, dest, mode);
  } catch (err) {
    if (
      err?.code === "ENOTSUP" ||
      err?.code === "EINVAL" ||
      err?.code === "EOPNOTSUPP" ||
      err?.code === "EXDEV" ||
      err?.code === "ERR_FS_COPYFILE_IMPL"
    ) {
      await fsp.copyFile(src, dest);
    } else if (err?.code === "EEXIST" && overwrite === false) {
      return;
    } else {
      throw err;
    }
  }
}
