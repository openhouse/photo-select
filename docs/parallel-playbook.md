# Tuning `--parallel`

This guide summarises a rule-of-thumb approach for choosing the `--parallel` flag when running `photo-select` on a single workstation. It assumes the OpenAI API calls dominate overall latency.

## 1. Identify the true bottleneck for each stage

| Stage | Typical resource ceiling | What to watch |
| ----- | ----------------------- | ------------- |
| Local image pre‑processing (EXIF read, thumbnail, hash) | **CPU** and disk | `%CPU` per core, read IOPS |
| JSON packaging & upload to ChatGPT | **Network** and OpenAI **rate‑limit** | µs/KB throughput, `429` errors |
| ChatGPT response parsing | **CPU (single‑thread)** + **RAM** | single core pegged? RAM climb? |
| File moves (keep/aside) | Disk / filesystem overlay | Finder/Drive sync queue length |

Because the heaviest step is the remote LLM call, the pipeline is mostly **I/O‑latency bound**, not CPU‑bound.

## 2. Quick empirical starting point

| Workstation class | Rough "good first guess" |
| ----------------- | ----------------------- |
| 4‑core / 8‑thread (Intel i5 / M1) | **4–6** |
| 8‑core / 16‑thread (M2 Pro, Ryzen 7) | **8–10** |
| 12–16 high‑perf cores (M3 Max, Threadripper) | **12–14** |

Workers spend most of their time waiting on the network, so around **2×** your physical core count usually saturates the connection without exhausting RAM.

## 3. Derive it from your own numbers

1. **Measure one batch end‑to‑end latency**.
2. **Compute local prep time** (`T_prep`) versus remote wait (`T_API`).
3. **Set `parallel ≈ ceil(T_API / T_prep)`**.
4. **Add 10–20 % head‑room** to mask variance.

## 4. Verify with a two‑cycle test

```bash
photo-select-here.sh --parallel 14  # dry run on ~200 images
watch -n5 '
  echo "--- $(date)";
  ps -o pid,%cpu,%mem,command -p $(pgrep -f photo-select | tr "\n" ,);
  grep -i rate /tmp/photo-select*.log | tail -3
'
```

If CPU never rises much above **300 %** on an 8‑core machine, you can inch the number up. If you see `429` errors or file‑sync backlog, back it down. Estimated total time falls roughly as:

```
ETA ≈ (total_batches / parallel) × batch_time
```

## 5. Guard‑rails

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `429` or `Rate limit` | Exceeded OpenAI RPM/TPM | Lower `--parallel` or request increased quota |
| Google Drive "Retrying…" | File‑sync saturation | Point `_keep` to local SSD first, sync later |
| Memory creep | Many Node processes at once | Set `PHOTO_SELECT_MAX_OLD_SPACE_MB` lower (4 GB per worker is plenty) |
| CPU pegged at 100 % × cores | Too many heavyweight local transforms | Cap `parallel` at physical cores |

