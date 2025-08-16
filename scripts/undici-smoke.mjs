#!/usr/bin/env node
// Minimal Undici smoke test: one warm-up request, then N parallel requests.
// Prints socket/ALPN info via diagnostics_channel.
import { Agent, setGlobalDispatcher, fetch } from 'undici';
import dns from 'node:dns';
import { performance } from 'node:perf_hooks';
import { channel } from 'node:diagnostics_channel';

const url =
  process.argv[2] ||
  (process.env.OPENAI_API_KEY
    ? 'https://api.openai.com/v1/models'
    : 'https://httpbin.org/get');

const concurrency   = Number(process.env.SMOKE_CONCURRENCY || 4);
const timeoutMs     = Number(process.env.SMOKE_TIMEOUT_MS || 15000);
const connections   = Number(process.env.PHOTO_SELECT_MAX_SOCKETS || 8);
const keepAliveMs   = Number(process.env.PHOTO_SELECT_KEEPALIVE_MS || 10000);
const maxKeepAlive  = Number(process.env.PHOTO_SELECT_FREE_SOCKET_TIMEOUT_MS || 60000);

// Tuned global dispatcher (so global fetch/OpenAI client will use it too)
const agent = new Agent({
  connections,
  keepAliveTimeout: keepAliveMs,
  keepAliveMaxTimeout: maxKeepAlive,
  headersTimeout: timeoutMs,
  bodyTimeout: timeoutMs,
});
setGlobalDispatcher(agent);

// Lightweight visibility into the socket lifecycle
let connects = 0, destroyed = 0;
channel('undici:client:connect').subscribe(({ connectParams }) => {
  console.log(`↪︎ connect ${connectParams.origin}`);
});
channel('undici:client:connected').subscribe(({ socket }) => {
  connects++;
  console.log(
    `✔ connected alpn=${socket.alpnProtocol || 'h1'} ` +
    `remote=${socket.remoteAddress}:${socket.remotePort} ` +
    `local=${socket.localAddress}:${socket.localPort}`
  );
});
channel('undici:client:destroy').subscribe(({ error }) => {
  destroyed++;
  console.warn(`✖ destroy: ${error?.code || error?.message || 'no error'}`);
});

console.log(
  `🔧 node=${process.version} dns=${dns.getDefaultResultOrder?.() || 'system'} ` +
  `url=${url}`
);
console.log(
  `🔌 undici connections=${connections} keepAlive=${keepAliveMs}ms ` +
  `maxKeepAlive=${maxKeepAlive}ms concurrency=${concurrency} timeout=${timeoutMs}ms`
);

const headers = {};
if (/openai\.com/.test(url) && process.env.OPENAI_API_KEY) {
  headers.Authorization = `Bearer ${process.env.OPENAI_API_KEY}`;
}

const t0 = performance.now();
const first = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
const t1 = performance.now();
console.log(
  `① status=${first.status} ${first.statusText} ` +
  `took=${Math.round(t1 - t0)}ms connection=${first.headers.get('connection') || 'n/a'} ` +
  `server=${first.headers.get('server') || 'n/a'}`
);
const sample = (await first.text()).slice(0, 200).replace(/\s+/g, ' ');
console.log(`   body[0:200]=${JSON.stringify(sample)}`);

const t2 = performance.now();
await Promise.all(
  Array.from({ length: concurrency }, () =>
    fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) }).then(r => r.arrayBuffer())
  )
);
const t3 = performance.now();
console.log(`② ${concurrency}× parallel ok in ${Math.round(t3 - t2)}ms`);

await agent.close();
console.log(`🔁 sockets opened=${connects} destroyed=${destroyed}`);

