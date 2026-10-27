---
id: photo-select-xiaomi-batch
title: Durable Xiaomi Batch curation
kind: method
status: draft
visibility: public-safe
sensitivity: low
last_reviewed: 2026-10-27
canonical_path: wiki/xiaomi-batch.md
summary: Preserve curation inputs and private provenance across asynchronous MiMo jobs and partial results.
relations: [{type: related_to, target: photo-select-rfc-0014, href: ../docs/rfcs/0014-xiaomi-batch.md, context: Proposed Batch transport and acceptance gates.}, {type: uses_method, target: photo-select-hosted-open-weights, href: hosted-open-weights.md, context: Existing hosted-provider contract.}]
---

# Durable Xiaomi Batch curation

[RFC 0014](../docs/rfcs/0014-xiaomi-batch.md) proposes `xiaomi-batch` for discounted
offline curation. It is not implemented. The existing `xiaomi` command continues
to send synchronous requests. `--batch-size 10` controls images in each request;
it does not select the vendor's Batch service.

Apply the [hosted-provider method](hosted-open-weights.md) to a second lifecycle:
prepare frozen requests, upload bounded JSONL, record remote IDs, poll, reconcile
complete output/error sets, validate phases, and apply each accepted result once.
Known jobs resume; uncertain submission outcomes hold before another paid write.
Partial successes retain their receipts and billing even when the job fails.

Keep source/derivative hashes, context, ordinary prompt bytes, exact names and
batch-local People additions stable. Repairs and field-note passes retain those
bindings. With field notes, whole batch sessions stay serial. A delayed response
must pass freshness checks before notebook updates or file moves.

The [Batch guide](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/batch-api)
and [pricing](https://mimo.mi.com/docs/en-US/price/pay-as-you-go), checked
2026-10-27, document a 50% unit-price discount and cache-hit rates. They do not
prove this account's regional access or ten-image Batch compatibility. The
conflicting completion-window wording, unstated scheduling timezone, cleanup
semantics, and multimodal acceptance remain explicit gates in the RFC.

Treat uploaded images, names and briefs as private remote files. Keep credentials
out of JSONL and journals; bind their destination to the verified exact regional
origin. Capture local evidence before supported remote cleanup, and report
unverified deletion and unknown usage honestly. Local receipt reuse and provider
prompt-cache discounts are different mechanisms.

Return through the [wiki index](index.md) or inspect the [typed registry](graph.json).
