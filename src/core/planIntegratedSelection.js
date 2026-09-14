const imagePattern = /\.(jpe?g|png|tiff?|webp|heic|avif|gif|dng)$/i;
export const isIntegrationImage = name => imagePattern.test(name);

export function planIntegratedSelection(config) {
  if (!Number.isInteger(config.step) || config.step < 2) throw new Error('Invalid integration step.');
  if (!config.previous?.files?.length || !Array.isArray(config.sources) || config.sources.length < 2) throw new Error('Preceding inventory and two source runs are required.');
  const validate = row => {
    if (typeof row.filename !== 'string' || /[\\/\x00]/.test(row.filename) || !isIntegrationImage(row.filename)) throw new Error('Invalid image filename.');
    if (!/^[a-f0-9]{64}$/.test(row.sha256) || !Number.isSafeInteger(row.bytes) || row.bytes < 1) throw new Error('Invalid frozen file hash or size.');
  };
  const pool = new Map(); const runs = new Set(); const portableNames = new Map();
  for (const source of config.sources) {
    if (!source.id || runs.has(source.id)) throw new Error('Duplicate or missing source run.'); runs.add(source.id);
    if (!Number.isInteger(source.terminalLevel) || source.level < 1 || source.level !== source.terminalLevel - config.step + 1) throw new Error('Source level must step back exactly once per integration.');
    const names = new Set();
    for (const row of source.files) {
      validate(row); if (names.has(row.filename)) throw new Error('Duplicate source filename.'); names.add(row.filename);
      const portable = row.filename.normalize('NFC').toLowerCase();
      if (portableNames.has(portable) && portableNames.get(portable) !== row.filename) throw new Error('Case or Unicode filename collision.');
      portableNames.set(portable, row.filename);
      const existing = pool.get(row.filename);
      if (existing && (existing.sha256 !== row.sha256 || existing.bytes !== row.bytes)) throw new Error('Conflicting bytes for filename: ' + row.filename);
      if (!existing) pool.set(row.filename, { ...row, witnesses: [] });
      pool.get(row.filename).witnesses.push({ run: source.id, level: source.level, directory: source.directory });
    }
  }
  const preceding = new Set();
  for (const row of config.previous.files) {
    validate(row); if (preceding.has(row.filename)) throw new Error('Duplicate preceding filename.'); preceding.add(row.filename);
    const source = pool.get(row.filename);
    if (!source || source.sha256 !== row.sha256 || source.bytes !== row.bytes) throw new Error('Preceding photo missing or changed in source pool: ' + row.filename);
  }
  const decisions = new Map();
  for (const row of config.decisions) {
    if (decisions.has(row.filename)) throw new Error('Duplicate decision.');
    if (!pool.has(row.filename)) throw new Error('Unknown decision filename.');
    if (!['inherit', 'add', 'aside'].includes(row.decision)) throw new Error('Invalid decision.');
    if (typeof row.reason !== 'string' || !row.reason.trim()) throw new Error('Every decision requires a reason.');
    if (preceding.has(row.filename) !== (row.decision === 'inherit')) throw new Error('Every preceding photo must inherit unchanged.');
    decisions.set(row.filename, row);
  }
  if (decisions.size !== pool.size) throw new Error('Decision coverage must include every candidate.');
  const photos = [...pool.values()].filter(row => decisions.get(row.filename).decision !== 'aside')
    .map(row => ({ ...row, inherited: preceding.has(row.filename) })).sort((a, b) => a.filename.localeCompare(b.filename));
  return { photos, count: photos.length, previousCount: preceding.size, addedCount: photos.length - preceding.size, candidateCount: pool.size };
}
