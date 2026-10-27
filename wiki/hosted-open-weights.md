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
MiMo V2.6 Pro as the first case. A dedicated adapter has synthetic transport and
workflow tests; published capabilities motivate a pilot.
Live authentication and synthetic image/schema checks passed on 2026-10-26.
A synthetic decision contradicted its reason, so structured replies alone do not
establish reliable selection. Real-photo usefulness, reasoning controls, cache
behavior and cost savings remain unverified. A hosted alias does not prove a
weights revision.

The real-photo pilot received HTTP 400: `Too many images in request: 6 > 4`.
Use batches of at most four images on DeepInfra. Reject larger direct requests
before upload, and preserve that limit in repair and field-note passes.
Smaller image dimensions do not remove this limit. After the batching fix, a
[six-photo pilot](../evals/reports/deepinfra-real-photo-pilot-2026-10-26.json)
completed as four plus two, with one recovered contract repair. The final
selections agreed with reasons and file moves, but the review found unsupported
motion/time claims and broken notebook links. Keep this small custom-prompt
result separate from general acceptance, Jamie's judgment and savings.

A separate [Xiaomi direct compatibility pilot](../evals/reports/xiaomi-direct-compatibility-pilot-2026-10-26.json)
completed triage, one closing-question repair, and field notes with ten independent
image inputs in every request. All three replies parsed as JSON; two passed the
contract on arrival. Usage-based estimated cost was $0.01485, including repair.
Assistant visual review found correct image mapping alongside unsupported count,
orientation, time and season claims. This private harness test does not add a
production Xiaomi CLI provider or change DeepInfra's four-image cap. Keep its
JSON-mode/local-validation result separate from strict server-side schema support,
unattended readiness and comparative savings.

The separate `xiaomi` CLI provider now supports the ordinary photo workflow,
including field notes, with its own credentials, endpoint, request identity and
private journal binding. Its [runtime profile](../evals/xiaomi-open-weights.json)
keeps synthetic implementation checks separate from the predecessor harness and
pending broader live acceptance. Use `--provider xiaomi --batch-size 10
--workers 1 --reasoning-effort auto` with the same curator list and context.
Batch size controls images per request; `--target-level-size` still controls
when recursive refinement stops. DeepInfra retains its four-image limit.
A [normal-launcher ten-photo test](../evals/reports/xiaomi-cli-real-photo-pilot-2026-10-26.json)
then completed both phases with 17 exact curator names and two contract-valid
replies without repair. Working-copy sorting, notebook links, frozen input hashes
and private Git provenance were verified; estimated token cost was $0.01519.
An earlier candidate omitted decisions and was held after its one repair failed.
Both receipts remain distinct. The successful bounded test does not measure
large-library recursion, the exhibition brief, editorial agreement or savings.

The [evaluation profile](../evals/hosted-open-weights.json) retains dated sources
and unknown measurements. Run `npm run evals:hosted-open-weights` for graph
integrity, cost scenarios and synthetic provider checks, then `npm run hillclimb`
for repository checks.
These checks make no model requests and evaluate no actual photographic edit.

Future providers should reuse the capability/audit contract and add their own
source records and acceptance evidence. A source update or changed candidate
requires a new bound receipt. Preserve older evidence as historical.
