import { AdaptiveConcurrencyController } from '../src/core/adaptiveConcurrency.js';
const candidates = [['conservative', 3],
  ['balanced', 2],
  ['aggressive', 1],
];
const hit = { cacheHit: true, estimatedTokens: 100 };
function evaluate([name, successesPerIncrease]) {
  const make = () => new AdaptiveConcurrencyController({
    minConcurrency: 1, maxConcurrency: 8, successesPerIncrease,
    cacheKeyRequestsPerMinute: Infinity,
  });
  const ramp = make();
  ramp.observe(hit); ramp.observe(hit);
  const afterTwoHits = ramp.snapshot().targetConcurrency;
  let projectedWork = 0;
  const throughput = make();
  for (let window = 0; window < 8; window += 1) {
    const width = throughput.snapshot().targetConcurrency;
    projectedWork += width;
    for (let i = 0; i < width; i += 1) throughput.observe(hit);
  }
  throughput.observe({ cacheHit: false });
  return { name, successesPerIncrease, projectedWork, afterTwoHits,
    cacheMissFloor: throughput.snapshot().targetConcurrency };
}
const results = candidates.map(evaluate);
const eligible = results.filter((item) =>
  item.afterTwoHits <= 2 && item.cacheMissFloor === 1);
const winner = eligible.sort((a, b) => b.projectedWork - a.projectedWork)[0];
console.log(JSON.stringify({ metric: 'projected_cached_requests', results, winner }, null, 2));
if (winner?.name !== 'balanced') process.exitCode = 1;
