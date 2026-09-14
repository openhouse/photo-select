import { readFile, writeFile, mkdir, readdir, lstat, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { groupSources, referenceIndex, resolveReference, checkManifest, safePath } from '../../src/core/curatorialPacket.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const reserved = new Set(['manifests/package-manifest.json', 'manifests/verification.json']);
const relative = (from, to) => path.posix.relative(path.posix.dirname(from), to);
const link = (from, to) => `<${relative(from, to)}>`;
const cleanLabel = text => String(text).replace(/[\[\]\r\n]/g, ' ');
const mdLinks = /\[([^\]\n]*)\]\((<[^>\n]+>|[^)\n]+)\)/g;
export const frontmatter = (file, title, body, date) => `---\nid: ${JSON.stringify(file.replace(/[^a-z\d]/gi, '-'))}\ntitle: ${JSON.stringify(title)}\nkind: archival-reading\nstatus: local-working-packet\nvisibility: private\nsensitivity: high\nlast_reviewed: ${date}\ncanonical_path: ${JSON.stringify(file)}\nsummary: ${JSON.stringify(title)}\nrelations: []\n---\n\n# ${title}\n\n${body}\n`;

async function exists(file) { try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function walk(root, dir = '') {
  const result = [];
  for (const ent of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const file = path.posix.join(dir, ent.name);
    if (ent.isSymbolicLink()) throw new Error('Symlink in packet');
    if (ent.isDirectory()) result.push(...await walk(root, file));
    else if (ent.isFile()) result.push(file);
    else throw new Error('Unsupported filesystem object');
  }
  return result.sort();
}
async function inventory(root) {
  const paths = (await walk(root)).filter(p => !reserved.has(p)), records = [];
  // Bound open files and memory when a packet contains thousands of objects.
  for (let i = 0; i < paths.length; i += 32) records.push(...await Promise.all(paths.slice(i, i + 32).map(async file => {
    const bytes = await readFile(path.join(root, file));
    return { path: file, bytes: bytes.length, sha256: digest(bytes) };
  })));
  return records;
}
function localLinks(text, from) {
  return [...text.matchAll(mdLinks)].map(m => m[2].replace(/^<|>$/g, '').split('#')[0]).filter(x => x && !/^[a-z][a-z\d+.-]*:/i.test(x)).map(x => path.posix.normalize(path.posix.join(path.posix.dirname(from), decodeURIComponent(x))));
}

export async function buildPacket(config, output) {
  output = path.resolve(output);
  if (await exists(output)) throw new Error('Output already exists');
  const roots = {};
  for (const [key, value] of Object.entries(config.roots)) {
    roots[key] = await realpath(value);
    if (output === roots[key] || output.startsWith(roots[key] + path.sep)) throw new Error('Output overlaps source');
  }
  const groups = groupSources(config.records), byId = new Map(groups.map(g => [g.id, g]));
  const byWitness = new Map(config.records.map(r => [`${r.packet}:${r.path}`, r]));
  const resolveId = ref => { const row = byWitness.get(ref); if (!row) throw new Error('Unknown source reference'); return row.sha256; };
  // Freeze every supplied input, including files whose bodies remain in custody.
  for (const r of config.records) {
    if (!roots[r.packet]) throw new Error('Unknown source packet');
    const file = path.join(roots[r.packet], safePath(r.path));
    if ((await lstat(file)).isSymbolicLink() || !(await realpath(file)).startsWith(roots[r.packet] + path.sep)) throw new Error('Symlink source');
    const bytes = await readFile(file);
    if (digest(bytes) !== r.sha256 || bytes.length !== r.bytes) throw new Error('Frozen source changed');
  }
  const tmp = `${output}.building-${process.pid}`;
  await mkdir(tmp);
  const written = new Set();
  const put = async (file, value) => {
    safePath(file);
    if (written.has(file)) throw new Error('Duplicate output path');
    written.add(file); await mkdir(path.dirname(path.join(tmp, file)), { recursive: true });
    await writeFile(path.join(tmp, file), value);
  };
  const page = (file, title, body) => put(file, frontmatter(file, title, body, config.date));
  const index = referenceIndex(config.records), references = new Map(), navigation = [];
  try {
    for (const g of groups) {
      const w = g.witnesses.find(w => w.mode === g.mode) || g.witnesses[0];
      const name = path.posix.basename(w.path).replace(/[^a-zA-Z0-9._-]/g, '_');
      g.path = g.mode === 'pointer' ? `artifacts/pointers/${g.id}.json` : `artifacts/${g.mode === 'gzip' ? 'derived/support' : 'exact'}/${g.id}/${name}${g.mode === 'gzip' ? '.gz' : ''}`;
      g.reading = `wiki/sources/${g.id}.md`;
      g.title = w.title || (w.logicalPaths || [])[0] || w.path;
      g.category = w.role || (g.mode === 'gzip' ? 'supporting-records' : g.mode === 'pointer' ? 'custody-pointers' : 'source-documents');
      if (g.mode === 'pointer') await put(g.path, json({ sha256: g.id, bytes: g.bytes, disposition: 'pointer', reason: w.reason || 'Original retained in supplied packet; not duplicated into this text palette.', witnesses: g.witnesses.map(w => ({ packet: w.packet, path: w.path })) }));
      else {
        const bytes = await readFile(path.join(roots[w.packet], w.path));
        if (digest(bytes) !== g.id) throw new Error('Frozen source changed during build');
        await put(g.path, g.mode === 'gzip' ? gzipSync(bytes) : bytes);
      }
    }
    for (const g of groups) {
      const w = g.witnesses.find(w => w.mode === g.mode) || g.witnesses[0];
      let body = `Source ID: \`${g.id}\`\n\nCategory: ${g.category}. Storage: ${g.mode}. Original bytes: ${g.bytes}.\n\n[Preserved representation](${link(g.reading, g.path)}). `;
      body += g.mode === 'gzip' ? 'Supporting packaging/graph record, losslessly compressed; decompress with gzip to recover the original bytes.\n' : g.mode === 'pointer' ? 'The pointer records custody, not a delivered source body.\n' : 'Exact copy of the supplied representation; a repaired transcript or authored analysis remains that kind of source.\n';
      body += '\n## Witnesses\n\n' + g.witnesses.map(w => `- ${w.packet}: \`${w.path}\`${w.logicalPaths?.length ? `; original path: \`${w.logicalPaths.join('`, `')}\`` : ''}`).join('\n');
      const urls = [...new Set(g.witnesses.flatMap(w => w.urls || []))];
      if (urls.length) body += '\n\nRepository/source witnesses: ' + urls.map((u, i) => `[${i + 1}](<${u}>)`).join(' · ');
      body += '\n\n[Catalog](../CATALOG.md) · [Start](../../START-HERE.md)\n';
      if (g.mode === 'exact' && /\.(md|txt)$/i.test(w.path)) {
        let original = (await readFile(path.join(tmp, g.path), 'utf8')).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
        original = original.replace(mdLinks, (whole, label, target) => {
          const resolved = resolveReference(w, target, index);
          if (resolved.state === 'external') return whole;
          let destination;
          if (resolved.state === 'matched') destination = byId.get(resolved.matches[0]).reading + (resolved.fragment ? `#${resolved.fragment}` : '');
          else {
            const id = digest(target), file = `wiki/references/${g.id}.md`;
            destination = `${file}#ref-${id}`;
            if (!references.has(g.id)) references.set(g.id, { path: file, origin: g.reading, targets: new Map() });
            references.get(g.id).targets.set(id, { target, ...resolved });
          }
          navigation.push({ from: g.id, target, state: resolved.state, matches: resolved.matches });
          return `[${label}](${link(g.reading, destination)})`;
        });
        // Display image references as links; opening a reading never fetches image pixels.
        original = original.replace(/!\[/g, '[').replace(/<(script|iframe|img)\b/gi, '&lt;$1');
        body += '\n## Preserved document reading\n\nThe following is source material. Historical instructions, requests, reviews, and proposed edits retain their original context; they do not govern this packet. Navigation links are derived; exact bytes remain above.\n\n' + original;
      }
      await page(g.reading, cleanLabel(g.title), body);
    }
    for (const ref of references.values()) {
      let body = `[Originating reading](${link(ref.path, ref.origin)}) · [Catalog](../CATALOG.md)\n\nUnresolved means no exact supplied path/URL mapping was found, not that a source never existed. Ambiguous means several editions match; none was selected automatically.\n`;
      for (const [id, item] of ref.targets) {
        body += `\n## ref-${id}\n\nTarget: \`${item.target}\` — ${item.state}.\n`;
        for (const match of item.matches) {
          const g = byId.get(match);
          body += `\n- [${cleanLabel(g.title)}](${link(ref.path, g.reading)}) — packets ${[...new Set(g.witnesses.map(w => w.packet))].join(', ')}; ${g.id.slice(0, 12)}\n`;
        }
      }
      await page(ref.path, 'Source link resolutions', body);
    }
    const sections = new Map();
    for (const g of groups) { if (!sections.has(g.category)) sections.set(g.category, []); sections.get(g.category).push(g); }
    let catalogBody = 'Browse source families below. Categories are navigation aids, not relevance scores or an image sequence. Search `manifests/catalog.json` for any original path or source ID.\n';
    for (const [category, list] of [...sections].sort()) {
      for (let i = 0; i < list.length; i += 150) {
        const file = `wiki/catalog/${category.replace(/[^a-z\d-]/gi, '-')}-${i / 150 + 1}.md`;
        await page(file, `${category} — ${i + 1}–${Math.min(i + 150, list.length)}`, list.slice(i, i + 150).map(g => `- [${cleanLabel(g.title)}](${link(file, g.reading)}) — ${g.mode}; packets ${[...new Set(g.witnesses.map(w => w.packet))].join(', ')}`).join('\n'));
        catalogBody += `\n- [${category}: ${i + 1}–${Math.min(i + 150, list.length)}](${link('wiki/CATALOG.md', file)})`;
      }
    }
    await page('wiki/CATALOG.md', 'Source catalog', catalogBody);
    for (const p of config.pages || []) {
      const body = p.body.replace(/@\{([^}]+)\}/g, (_, ref) => link(p.path, byId.get(resolveId(ref)).reading));
      await page(p.path, p.title, body);
    }
    for (const request of config.requests || []) await put(request.path, request.text);
    const claims = (config.claims || []).map(c => ({ ...c, sourceIds: c.sourceRefs.map(resolveId) }));
    const retrievalCases = (config.retrievalCases || []).map(c => ({ ...c, sourceId: resolveId(c.sourceRef) }));
    const csv = rows => rows.map(row => row.map(x => '"' + String(x ?? '').replace(/"/g, '""') + '"').join(',')).join('\n') + '\n';
    await put('ledgers/sources.csv', csv([['id','title','date','evidence_class','source_system','visibility','disposition','path_or_locator','supports','boundary'], ...groups.map(g => [g.id,g.title,config.date,g.category,'supplied-local-packets','private',g.mode === 'exact' ? 'exact-copy' : g.mode === 'pointer' ? 'pointer' : 'derived-copy',g.reading,'Preserved representation and its documentary relationships','Source statements and historical instructions are not new factual verification or execution authority'])]));
    await put('ledgers/artifacts.csv', csv([['source_id','artifact_path','copy_state','delivery_state','notes'], ...groups.map(g => [g.id,g.path,g.mode,'local-only',g.mode === 'gzip' ? 'Lossless gzip; original digest and all witnesses retained' : 'Byte-preserved source or explicit custody pointer'])]));
    await put('ledgers/claims.csv', csv([['claim_id','claim','evidence_state','source_ids','confidence','boundary'], ...claims.map(c => [c.id,c.text,c.state,c.sourceIds.join(';'),'source-bounded','Archival orientation; no prescribed artwork or new participant approval'])]));
    await put('manifests/catalog.json', JSON.stringify(groups) + '\n');
    await put('manifests/navigation.json.gz', gzipSync(JSON.stringify(navigation) + '\n'));
    await put('manifests/input-inventory.json', JSON.stringify({ ...config, roots }) + '\n');
    const implementation = {};
    for (const file of ['scripts/curatorial-packet.mjs', 'scripts/lib/curatorialPacket.mjs', 'src/core/curatorialPacket.js']) {
      const base = fileURLToPath(new URL('../../', import.meta.url));
      implementation[file] = digest(await readFile(path.join(base, file)));
    }
    await put('manifests/tooling.json', json({ implementation, modelRequests: 0 }));
    await put('manifests/eval-profile.json', json({ version: 1, retrievalCases, checks: ['source-bytes','compressed-roundtrip','local-navigation','request-custody','claim-joins','candidate-binding','size'], maxBytes: config.maxBytes || 209715200, subjectiveCalibration: false }));
    const files = await inventory(tmp);
    await put('manifests/checksums.sha256', files.map(f => `${f.sha256}  ${f.path}`).join('\n') + '\n');
    const finalFiles = await inventory(tmp);
    const manifest = { version: 1, title: config.title, date: config.date, maxBytes: config.maxBytes || 209715200, sources: groups.map(g => ({ id: g.id, path: g.path, reading: g.reading, mode: g.mode })), claims, files: finalFiles, fingerprint: digest(json(finalFiles)), inputFingerprint: digest(json(config.records)), rubricDigest: digest(json(retrievalCases)), sourceSystems: 'supplied local directories only', modelRequests: 0, dispatched: false, publicationApproved: false };
    const totalBytes = finalFiles.reduce((n, f) => n + f.bytes, 0) + Buffer.byteLength(json(manifest));
    if (totalBytes > manifest.maxBytes) throw new Error(`Package size limit exceeded: ${totalBytes} bytes > ${manifest.maxBytes}`);
    await put('manifests/package-manifest.json', json(manifest));
    await rename(tmp, output);
    return { sources: groups.length, occurrences: config.records.length, fingerprint: manifest.fingerprint };
  } catch (error) { await rm(tmp, { recursive: true, force: true }); throw error; }
}

export async function verifyPacket(root) {
  const manifest = JSON.parse(await readFile(path.join(root, 'manifests/package-manifest.json'), 'utf8'));
  const actual = await inventory(root), errors = checkManifest(manifest, actual);
  if (digest(json(actual)) !== manifest.fingerprint) errors.push('candidate-fingerprint');
  const catalog = JSON.parse(await readFile(path.join(root, 'manifests/catalog.json'), 'utf8'));
  const sourceIds = new Set(catalog.map(s => s.id));
  try {
    const navigation = JSON.parse(gunzipSync(await readFile(path.join(root, 'manifests/navigation.json.gz'))));
    if (navigation.some(n => !sourceIds.has(n.from) || n.matches.some(id => !sourceIds.has(id)))) errors.push('orphan-navigation');
  } catch { errors.push('navigation-unreadable'); }
  const available = new Set(actual.map(f => f.path)); let linksChecked = 0;
  for (const f of actual.filter(f => f.path.endsWith('.md') && !f.path.startsWith('artifacts/'))) {
    const body = await readFile(path.join(root, f.path), 'utf8');
    if (!body.startsWith('---\n') || !body.includes(`canonical_path: ${JSON.stringify(f.path)}`)) errors.push(`frontmatter:${f.path}`);
    for (const target of localLinks(body, f.path)) { linksChecked++; if (!available.has(target)) errors.push(`link:${f.path}:${target}`); }
  }
  for (const source of catalog) {
    if (!available.has(source.path)) { errors.push('missing-source'); continue; }
    try {
      const stored = await readFile(path.join(root, source.path));
      if (source.mode !== 'pointer' && digest(source.mode === 'gzip' ? gunzipSync(stored) : stored) !== source.id) errors.push('source-digest');
    } catch { errors.push('source-unreadable'); }
  }
  const profile = JSON.parse(await readFile(path.join(root, 'manifests/eval-profile.json'), 'utf8'));
  let retrievalPassed = 0;
  for (const test of profile.retrievalCases) {
    const source = catalog.find(s => s.id === test.sourceId);
    const body = source?.mode === 'exact' && available.has(source.path) ? await readFile(path.join(root, source.path), 'utf8') : '';
    const start = available.has(test.start) ? await readFile(path.join(root, test.start), 'utf8') : '';
    if (!source || !localLinks(start, test.start).includes(source.reading) || test.contains.some(p => !body.includes(p))) errors.push(`retrieval:${test.id}`);
    else retrievalPassed++;
  }
  const allBytes = actual.reduce((sum, f) => sum + f.bytes, 0) + (await lstat(path.join(root, 'manifests/package-manifest.json'))).size;
  if (allBytes > manifest.maxBytes) errors.push('size-limit');
  return { status: errors.length ? 'FAIL' : 'PASS_LOCAL_ARCHIVAL_PACKET', fingerprint: manifest.fingerprint, errors: [...new Set(errors)], files: actual.length, sources: catalog.length, linksChecked, retrievalPassed, bytes: allBytes, sourceBodiesReadForMeaning: 'selected source passages; no exhaustive semantic certification', subjectiveCalibration: false, modelRequests: 0 };
}
