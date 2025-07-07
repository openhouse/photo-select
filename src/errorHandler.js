import { batchStore } from './batchContext.js';

process.on('uncaughtException', (err) => {
  if (err?.code === 'EPIPE') {
    const info = batchStore.getStore();
    const prefix = info?.batch ? `Batch ${info.batch} ` : '';
    console.warn(`\u26A0\uFE0F  ${prefix}socket error: ${err.message}`);
    return;
  }
  console.error('uncaught exception', err);
  process.exit(1);
});
