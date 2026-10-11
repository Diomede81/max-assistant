/** Case-insensitive wildcard match: "OUTLOOK_*EVENT*" matches "OUTLOOK_CREATE_EVENT". */
export function matchesAny(name: string, patterns: string[] | undefined): boolean {
  if (!patterns?.length) return false;
  return patterns.some((p) => {
    const re = new RegExp('^' + p.trim().split('*').map(escape).join('.*') + '$', 'i');
    return re.test(name);
  });
}

function escape(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}
