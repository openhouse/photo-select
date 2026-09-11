// Inspect web URLs in the supplied context, never other prompt fields.
export function contextHasGithubLinks(context = '') {
  for (const match of context.matchAll(/(?<![\w+.-])https?:\/\/[^\s<>"'`]+/gi)) {
    // Prose and Markdown commonly put punctuation immediately after a URL.
    const candidate = match[0].replace(/[),.;!?\]}]+$/, '');
    try {
      const {hostname} = new URL(candidate);
      if (hostname === 'github.com' || hostname === 'www.github.com') return true;
    } catch {
      // Malformed links do not enable the section.
    }
  }
  return false;
}
