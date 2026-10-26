---
id: photo-select-hosted-open-weights
title: Hosted open weights for photographic reading
kind: method
status: draft
visibility: public-safe
sensitivity: low
last_reviewed: 2026-10-26
canonical_path: wiki/hosted-open-weights.md
summary: Compare hosted models through explicit provider capabilities, private provenance and human editorial review.
relations: [{type: related_to, target: photo-select-rfc-0013, href: ../docs/rfcs/0013-hosted-open-weights.md, context: First proposed provider contract.}]
---

# Hosted open weights for photographic reading

A model, its hosting service, API transport, credentials, runtime precision and
photographic usefulness are separate parts of a candidate. Record their exact
bindings. A provider change must preserve the brief, curator roster, metadata,
image identity, decisions and revision history.

[RFC 0013](../docs/rfcs/0013-hosted-open-weights.md) proposes DeepInfra's hosted
MiMo V2.6 Pro as the first case. Its published capabilities motivate a pilot;
the actual image/schema combination, reasoning controls, cache behavior and cost
remain unverified. A hosted alias does not prove a weights revision.

The [evaluation profile](../evals/hosted-open-weights.json) retains dated sources
and unknown measurements. Run `npm run evals:hosted-open-weights` for local graph
integrity and cost scenarios, then `npm run hillclimb` for repository checks.
These checks make no model requests and evaluate no actual photographic edit.

Future providers should reuse the capability/audit contract and add their own
source records and acceptance evidence. A source update or changed candidate
requires a new bound receipt. Preserve older evidence as historical.
