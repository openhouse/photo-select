// Configure HTTP stack from env. By default this is a NO-OP.
// To enable Undici tuning, set: PHOTO_SELECT_HTTP_DRIVER=undici
// We keep the import lazy and opt-in to avoid boot hangs on systems
// where `import('undici')` misbehaves.

function num(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export async function configureHttpFromEnv() {
  const driver = String(process.env.PHOTO_SELECT_HTTP_DRIVER || '').toLowerCase();
  if (driver !== 'undici') {
    if (process.env.PHOTO_SELECT_VERBOSE === '1') {
      console.log('⚙️  HTTP: using Node default dispatcher (no Undici override)');
    }
    return false;
  }

  try {
    // Prefer CommonJS require when available; fall back to dynamic import.
    // This tends to be more robust across setups.
    let Agent, setGlobalDispatcher;
    try {
      const { createRequire } = await import('node:module');
      const require = createRequire(import.meta.url);
      ({ Agent, setGlobalDispatcher } = require('undici'));
    } catch {
      ({ Agent, setGlobalDispatcher } = await import('undici'));
    }

    const connections = num('UNDICI_CONNECTIONS', num('PHOTO_SELECT_MAX_SOCKETS', 8));
    const keepAliveTimeout = num('UNDICI_KEEPALIVE_MS', 10_000);
    const keepAliveMaxTimeout = num('UNDICI_FREE_TIMEOUT_MS', 60_000);
    const defaultTimeout = num('PHOTO_SELECT_TIMEOUT_MS', 600_000);
    const bodyTimeout = num('UNDICI_BODY_TIMEOUT_MS', defaultTimeout);
    const headersTimeout = num('UNDICI_HEADERS_TIMEOUT_MS', defaultTimeout);

    setGlobalDispatcher(new Agent({
      connections,
      pipelining: 1,
      keepAliveTimeout,
      keepAliveMaxTimeout,
      bodyTimeout,
      headersTimeout,
    }));

    if (process.env.PHOTO_SELECT_VERBOSE === '1') {
      console.log(
        `⚙️  HTTP: undici dispatcher set (connections=${connections}, ` +
          `keepAlive=${keepAliveTimeout}ms, freeTimeout=${keepAliveMaxTimeout}ms, ` +
          `headersTimeout=${headersTimeout}ms, bodyTimeout=${bodyTimeout}ms)`
      );
    }
    return true;
  } catch (e) {
    console.warn('⚠️  HTTP: failed to configure undici dispatcher; continuing with defaults:', e?.message || e);
    return false;
  }
}

export async function drain(err) {
  const res = err?.response;
  if (!res?.body?.getReader) return;
  try {
    const reader = res.body.getReader();
    while (!(await reader.read()).done) {}
  } catch {}
}

export async function closeDispatcher() {
  try {
    let getGlobalDispatcher;
    try {
      const { createRequire } = await import('node:module');
      const require = createRequire(import.meta.url);
      ({ getGlobalDispatcher } = require('undici'));
    } catch {
      ({ getGlobalDispatcher } = await import('undici'));
    }
    const dispatcher = getGlobalDispatcher();
    await dispatcher.close();
  } catch {}
}
