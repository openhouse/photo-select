/** Derive the private notebook from the same completed receipts committed beside it. */
export function hostedNotebook(records) {
  let text = '# Private hosted photographic field notes\n';
  for (const record of records) {
    if (record.status !== 'completed') continue;
    if (typeof record.json?.field_notes_md === 'string') { text = record.json.field_notes_md.trimEnd() + '\n'; continue; }
    text += `\n## ${record.key}\n\n`;
    text += (record.json?.minutes || []).map(item => `**${item.speaker}:** ${item.text}`).join('\n\n') + '\n\n';
    text += (record.json?.decisions || []).map(item => `- ${item.filename}: ${item.decision} — ${item.reason}`).join('\n') + '\n';
  }
  return text;
}
