---
id: photo-select-wiki
title: Photo Select Knowledge Wiki
kind: index
status: maintained
visibility: public-safe
sensitivity: low
last_reviewed: 2026-10-26
canonical_path: wiki/index.md
summary: Read proposals, methods and their bounded evidence without importing private curation records.
relations: [{type: uses_method, target: photo-select-hosted-open-weights, href: hosted-open-weights.md, context: Hosted-provider method.}]
---

# Photo Select Knowledge Wiki

Start with [hosted open weights](hosted-open-weights.md) and
[RFC 0013](../docs/rfcs/0013-hosted-open-weights.md). Existing related work includes
[private context](../docs/rfcs/0011-private-knowledge-context.md),
[live GitHub exploration](../docs/rfcs/0012-live-knowledge-exploration.md), and
[source-preserving palettes](../docs/curatorial-packets.md).

The [authored registry](graph.json) uses stable IDs and typed links. Semantic
edges express relationships; evidence edges attach dated sources. Prose links
are reading navigation. The evaluator checks registered paths and target/href
agreement; it does not crawl sources or claim exhaustive graph coverage.

This small local adaptation follows the pinned public
[schema](https://github.com/openhouse/jamieburk.art/blob/cf9415b4a93f336dbd0fa50ab6edf5442d113a96/docs/knowledge-bank/schema.md).
It adds an explicit `layer` on edges and external source `url` locators.
`graph.json` is authored, not an upstream generated graph. The eval report is a
derived verification artifact. RFC decision stage and wiki lifecycle status differ.
Private sources and operational records remain in their original custody.
