# Tuning `--parallel`

This guide summarises a rule-of-thumb approach for choosing the `--parallel` flag when running `photo-select` on a single workstation. It assumes the OpenAI API calls dominate overall latency.

## 1. Identify bottlenecks

Check CPU, RAM, and disk usage while a batch is running. The network wait time for the API is usually the limiting factor.

## 2. Quick starting points

| Workstation | Suggested `--parallel` |
|-------------|-----------------------|
| 4 cores      | 4–6 |
| 8 cores      | 8–10 |
| 12+ high‑perf cores | 12–14 |

The workers spend most of their time waiting on network responses, so running about twice the physical core count generally saturates the connection without exhausting RAM.

## 3. Estimate from your own run

1. Measure how long one batch of images takes end‑to‑end.
2. Compare local preprocessing time (`T_prep`) with the API wait (`T_API`).
3. Set `parallel ≈ ceil(T_API / T_prep)` and add about 10–20 % headroom.

## 4. Verify

Run a short dry pass with the chosen value and watch CPU usage and any `Rate limit` errors. Bump the number up if the machine stays mostly idle; dial it back if you hit rate limits or file‑sync delays.

## 5. Troubleshooting

| Symptom | Cause | Remedy |
|---------|-------|--------|
| `429` or `Rate limit` | Exceeded OpenAI request limits | Lower `--parallel` or request higher quota |
| File-sync backlog | Too many writes (e.g., Google Drive) | Write to a local folder first |
| Memory creep | Large number of Node processes | Limit `--parallel` or lower `PHOTO_SELECT_MAX_OLD_SPACE_MB` |

