/**
 * Cuts the LLM's token stream into speakable pieces. The first piece is released as
 * early as possible (a sentence end, or a comma after a few words) because it decides
 * how fast Max *feels*.
 */
export class SentenceSplitter {
  private buf = '';
  private first = true;

  push(fragment: string): string[] {
    this.buf += fragment;
    const out: string[] = [];
    for (;;) {
      const m = this.buf.match(/^(.+?[.!?;:])(\s+|$)/s) ??
        (this.first || this.buf.length > 120 ? this.buf.match(/^(.{25,}?,)(\s+)/s) : null);
      // No trailing space yet: wait, the "sentence end" may be a decimal point (e.g. "21.5").
      if (!m || m[2] === '') break;
      out.push(m[1].trim());
      this.buf = this.buf.slice(m[0].length);
      this.first = false;
    }
    return out;
  }

  flush(): string[] {
    const rest = this.buf.trim();
    this.buf = '';
    this.first = true;
    return rest ? [rest] : [];
  }
}
