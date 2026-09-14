# Close reading: knowledge as context for a photographic edit

Read on 2026-09-09. The four named voices below are fictionalized analytical lenses written by Codex, not quotations, participation, endorsement, or claims about those people's actual opinions. Private-source identities and detailed inspection receipts remain in Jamie's local research companion outside this public Git repository.

## What the repositories are doing

| Inspected public source | Close-reading finding |
| --- | --- |
| [Knowledge Wiki](https://github.com/openhouse/jamieburk.art/tree/1149267dbe8cba689656668d455138113f2995ff), RFCs 0004–0006, graph-layer policy and compiler entry point | Its central unit is a qualified assertion with source, agency, and projection boundary. Semantic distance is deliberately separated from evidence abundance. RFC 0004 has a bounded content pilot; RFC 0005 is exploring and RFC 0006 proposed. |
| [Active federation/sidecar branch](https://github.com/openhouse/jamieburk.art/tree/91d90891f11586a2df7fe49a598676b6bb4e7e5e), RFCs 0010–0011 and `layers.mjs` | Record, meaning, and permitted action are different maps. The sidecar keeps private understanding durable without public backlinks. This is a particular branch snapshot, not proof that every repository adopted its protocol. |
| [Localgraph](https://github.com/openhouse/localgraph/tree/c81586944299093fe3f2621de0f1a98696d4117e), README and account/import architecture; active branch `c109b8a43d09fa5bfbbeeabb22cfe0175d8c43af` README | Canonical correspondence and rebuildable views retain provenance and account boundaries. Freshness and historical completeness differ. A symlinked view is a discovery surface, not permission to import the source archive. |
| [Photo Fieldwork](https://github.com/openhouse/photo-fieldwork/tree/33082a9f17e8d9d6b1b3947d14db7f4559af5e01), README and workflow contract | Metadata makes a photograph findable; visual review and provenance answer different questions. Hashed proposals, burst-aware evaluation, and separate publication clearance are useful precedents for Photo Select. |
| [Photo Filter](https://github.com/openhouse/photo-filter/tree/e1fae8c37bacc62343b09df2276008634f135cc6), README and API orientation | Provides browsing, people metadata, and export infrastructure. Software labels and export freshness need source qualifications; they do not supply participant statements or release authority. |
| [Public Record](https://github.com/openhouse/jamie-burkart-public-record/tree/48135166faef864a49f732535280d27ec123d4aa), README/catalog orientation | One canonical body with many browse paths prevents duplicate copies from acquiring separate authority. Live repository visibility is public although the README still describes a private implementation candidate: prose status is not current access state. |
| [Photo Select](https://github.com/openhouse/photo-select/tree/f7a5a01dfc7badddbec9841df91a24d88d11d27c), prompt/template, roster, schema, providers, orchestration, field-note writer, cache and RFC 0010 | Already has an ensemble and a durable edit trail. It lacks typed knowledge input, verified source coverage, and audience-aware output. Its fixed-speaker contract and dynamic roster implementation also need reconciliation before private mode. |
| [Photo Select Skill](https://github.com/openhouse/photo-select-skill/tree/fa358f5fdbd6d0636a027190aa390e1601e4f225) | The inspected default tree contains only an ignore file; do not mistake a repository name for an implemented adapter. |

The private architecture review covered the portfolio sidecar, coalition operations, archival research, source editions, project-history knowledge, an operations control plane, and the packet compiler. Their responsibilities differ. The sidecar preserves situated understanding; source editions preserve attributable words; the operational layer distinguishes a candidate action from an accepted commitment; packet compilation freezes a selection without becoming its canonical authority. Some default branches contain little of the active proposal work. These are architectural observations, not a claim to have read every private artifact or reconstructed the event.

The packet compiler's directed traversal, dispositions, fingerprints, and compact-text verification are reusable machinery. Its own source adapters are deliberately absent. It cannot create GitHub access merely by receiving a private locator. Equally, a source repository's governance fields are evidence for an adapter to interpret, not self-authenticating permission supplied by whatever file a search returns.

## Yehuda Katz — fictionalized systems lens

I think the missing abstraction is a source contract. Photo Select currently receives a string; the ecosystem knows revisions, source authority, scope, and corrections. Those structures disappear at `buildPrompt`. The problem is therefore larger than attaching a GitHub tool. A broker should return an explicit snapshot with typed records, and each client should preserve that contract through its own request and output lifecycle.

The current branch offers a useful precedent: people prefetch verifies one corpus before parallel batches use it. Apply that discipline to context. Resolve once, keep the packet stable across passes, and invalidate when its policy changes. Do not let a cached paragraph outlive the permission that made it available. Start with the local adapter; making transport remote before stabilizing this boundary would multiply ways to lose it.

## Vivian Gornick — fictionalized narrative lens

I think the archive can tell you the circumstances while still leaving the photograph's narrative undecided. A listening event supplies a situation: who convened, what was said, what preceded it. The story emerges from Jamie's relation to that situation and from the arrangement of the photographs. The curators need access to that relation, including the revisions in his understanding.

But I would resist a machine that explains each picture until it becomes an illustration of the same thesis. Require the reading to say what is visible, what is contextual knowledge, and what is an interpretation brought into being by the edit. Let a picture trouble the context. The best retrieval may reveal that the initial story was too settled.

## Zora Neale Hurston — fictionalized ethnographic lens

I think many voices require more than many names. A person speaks somewhere, to someone, with a purpose, and sometimes against the terms offered by the institution collecting their words. Preserve that occasion. An unnamed speaker deserves a stable place in the record; a missing name is not a missing perspective.

The existing instruction to add repeatedly pictured people to the simulated discussion is especially troubling here. Being photographed does not make someone the author of the system's next sentence. Keep the person's sourced words, Jamie's account of the encounter, and the curator's invented reading distinct. Otherwise the technology appears to preserve a community while borrowing its members' voices.

## Deborah Treisman — fictionalized editorial lens

I think the useful question is what the added knowledge changes in the edit. After retrieval, can the curators defend a different opening, recover an overlooked image, recognize a repeated beat, or identify a tension that the first sequence concealed? Ask for a citation where context makes the difference, and a visual reason for keeping the frame.

Minutes are already durable artifacts in this software. That makes them a serious editorial surface. A private source can shape judgment without being repeated into a caption or attributed to a simulated person. Keep the private rationale rich; make each outward-facing form earn the context it actually needs.

## Codex's judgment

Build the bridge. The ecosystem's care in preserving attribution and uncertainty should become usable during photographic work. Its strongest contribution is the possibility of moving from an image to several situated accounts, then back to the image with sharper questions.

The first deliverable should be one source-pinned private event packet and a comparison of image-only, flat-context, and source-bound readings. Broad repository access is the capability; a coherent, inspectable research session is the unit of use. The [RFC](../rfcs/0011-private-knowledge-context.md) describes that path. Its synthetic tests measure contract behavior, while the usefulness of the actual edit remains for Jamie to judge.
