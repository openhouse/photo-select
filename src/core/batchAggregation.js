export const OPENAI_BATCH_MAX_REQUESTS = 50_000;
export const OPENAI_BATCH_MAX_BYTES = 200 * 1024 * 1024;

export function partitionBatchItems(
  items,
  {
    maxRequests = OPENAI_BATCH_MAX_REQUESTS,
    maxBytes = OPENAI_BATCH_MAX_BYTES,
  } = {}
) {
  const partitions = [];
  let current = [];
  let currentBytes = 0;

  for (const item of items) {
    const itemBytes = Buffer.byteLength(item.jsonl, 'utf8');
    if (itemBytes > maxBytes) {
      const err = new Error(
        `Batch item ${item.id || '<unknown>'} exceeds the ${maxBytes}-byte input limit`
      );
      err.code = 'BATCH_ITEM_TOO_LARGE';
      throw err;
    }
    if (
      current.length > 0 &&
      (current.length >= maxRequests || currentBytes + itemBytes > maxBytes)
    ) {
      partitions.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(item);
    currentBytes += itemBytes;
  }

  if (current.length > 0) partitions.push(current);
  return partitions;
}
