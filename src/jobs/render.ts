/**
 * How a scheduled task's result looks where it lands. The task writes plain text in a fixed shape (a title
 * line, headings, paragraphs, "- " lines); Max turns it into an email layout and a WhatsApp layout himself,
 * so the result is the same every time and the AI never writes HTML or decides how things look.
 */

export interface Piece {
  title: string;
  blocks: ({ kind: 'heading'; text: string } | { kind: 'para'; text: string } | { kind: 'list'; items: string[] })[];
}

/** Plain text in the task's shape → its parts. Markdown left in by the model (#, **, `) is removed rather than shown. */
export function parsePiece(text: string): Piece {
  const lines = clean(text)
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''));
  while (lines.length && !lines[0].trim()) lines.shift();
  const title = (lines.shift() ?? '').replace(/^#+\s*/, '').trim() || 'From Max';
  const blocks: Piece['blocks'] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'para', text: para.join(' ') });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) {
      flush();
      continue;
    }
    const item = l.match(/^(?:[-•*·]|\d+[.)])\s+(.*)$/);
    if (item) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'list') last.items.push(item[1]);
      else blocks.push({ kind: 'list', items: [item[1]] });
      continue;
    }
    // A short line without a full stop, followed by content: a heading ("Wednesday 28 October", "Prices:")
    const next = lines[i + 1]?.trim() ?? '';
    const headingLike = l.length <= 70 && !/[.!?]$/.test(l) && next && !para.length && (/^(?:[-•*·]|\d+[.)])\s/.test(next) || /:$/.test(l) || /^#+\s/.test(lines[i]));
    if (headingLike) {
      flush();
      blocks.push({ kind: 'heading', text: l.replace(/^#+\s*/, '').replace(/:$/, '') });
      continue;
    }
    para.push(l);
  }
  flush();
  return { title, blocks };
}

/** Markdown and HTML the model may have left in: gone. */
function clean(text: string): string {
  // a second copy of the answer written as an HTML document after the text: the text is the answer
  const doc = text.search(/<!doctype html|<html\b/i);
  if (doc > 40) text = text.slice(0, doc);
  return text
    .replace(/```[a-z]*\n?/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '');
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Bare links in a line become clickable. */
const linkify = (s: string) => escapeHtml(s).replace(/https?:\/\/[^\s<>"')\]]+/g, (u) => `<a href="${u}" style="color:#1a56db">${u}</a>`);

/** The email: one simple, consistent layout. */
export function toEmailHtml(piece: Piece, footer = 'Sent by Max'): string {
  const body = piece.blocks
    .map((b) => {
      if (b.kind === 'heading') return `<h2 style="font-size:17px;margin:22px 0 8px;color:#111">${linkify(b.text)}</h2>`;
      if (b.kind === 'list') return `<ul style="margin:0 0 14px;padding-left:22px">${b.items.map((i) => `<li style="margin:4px 0">${linkify(i)}</li>`).join('')}</ul>`;
      return `<p style="margin:0 0 14px">${linkify(b.text)}</p>`;
    })
    .join('\n');
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f6f7f9"><div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;padding:28px 32px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#222">
<h1 style="font-size:22px;margin:0 0 18px;color:#111">${linkify(piece.title)}</h1>
${body}
<p style="margin:26px 0 0;font-size:12px;color:#888">${escapeHtml(footer)}</p></div></body></html>`;
}

/** WhatsApp: bold title and headings, bullet lines. */
export function toWhatsApp(piece: Piece): string {
  const out = [`*${piece.title}*`];
  for (const b of piece.blocks) {
    if (b.kind === 'heading') out.push('', `*${b.text}*`);
    else if (b.kind === 'list') out.push(...b.items.map((i) => `• ${i}`));
    else out.push('', b.text);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Plain text (the dashboard, the spoken summary's source): the same shape, tidied. */
export function toPlain(piece: Piece): string {
  const out = [piece.title];
  for (const b of piece.blocks) {
    if (b.kind === 'heading') out.push('', b.text);
    else if (b.kind === 'list') out.push(...b.items.map((i) => `- ${i}`));
    else out.push('', b.text);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
