export function parseFormatEnv(varName) {
  if (Object.prototype.hasOwnProperty.call(process.env, varName)) {
    const raw = process.env[varName];
    if (raw === '') return null;
    try {
      return /^{/.test(raw.trim()) ? JSON.parse(raw) : raw;
    } catch {
      return raw;
    }
  }
  return undefined;
}

