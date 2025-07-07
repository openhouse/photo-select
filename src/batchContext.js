import { AsyncLocalStorage } from 'node:async_hooks';

export const batchStore = new AsyncLocalStorage();
