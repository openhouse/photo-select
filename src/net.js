// Configure Undici global dispatcher from PHOTO_SELECT_* env.
import { Agent, setGlobalDispatcher } from 'undici';

function num(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

export function configureHttpFromEnv() {
  const connections = num('PHOTO_SELECT_MAX_SOCKETS', 8);
  const keepAliveTimeout = num('PHOTO_SELECT_KEEPALIVE_MS', 10_000);
  const keepAliveMaxTimeout = num('PHOTO_SELECT_FREE_SOCKET_TIMEOUT_MS', 60_000);
  const bodyTimeout = num('PHOTO_SELECT_TIMEOUT_MS', 600_000);
  const headersTimeout = bodyTimeout;

  setGlobalDispatcher(new Agent({
    connections,
    pipelining: 1,
    keepAliveTimeout,
    keepAliveMaxTimeout,
    bodyTimeout,
    headersTimeout,
  }));
}
