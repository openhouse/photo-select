export function naiveApplyPatch(original, diff) {
  const doc = original.split(/\r?\n/);
  const lines = diff.split(/\r?\n/);
  let i = 0;
  for (const line of lines) {
    if (line.startsWith('@@')) {
      const context = line.replace(/^@@/, '').trim();
      if (context) {
        const idx = doc.indexOf(context, i);
        if (idx !== -1) i = idx;
      }
    } else if (line.startsWith('+')) {
      doc.splice(i, 0, line.slice(1));
      i++;
    } else if (line.startsWith('-')) {
      const idx = doc.indexOf(line.slice(1), i);
      if (idx !== -1) doc.splice(idx, 1);
    } else if (line.startsWith(' ')) {
      const idx = doc.indexOf(line.slice(1), i);
      if (idx !== -1) i = idx + 1;
    }
  }
  return doc.join('\n');
}
