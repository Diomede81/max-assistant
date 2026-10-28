/**
 * Emailing the user themselves (health plans, scheduled task results) through the personal
 * account's Gmail or Outlook action. Never the work account, never anyone else's address.
 */
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { McpServersService } from './mcp-servers.service';

const SEND_EMAIL = /^(GMAIL_SEND_EMAIL|OUTLOOK_(OUTLOOK_)?SEND_EMAIL|OUTLOOK_SEND_MAIL)$/;

type Server = McpServersService['list'][number];

/** The personal account's send-email action (Gmail or Outlook), if connected. */
export function selfEmailTool(mcp?: McpServersService): { server: Server; tool: ChatCompletionTool } | undefined {
  for (const s of mcp?.list ?? []) {
    if (/work/i.test(s.config.name)) continue; // the work account never sends personal things
    const tool = s.openAiTools.find((t) => t.type === 'function' && SEND_EMAIL.test(t.function.name));
    if (tool) return { server: s, tool };
  }
  return undefined;
}

/** Emails `to` through the personal account: the user's own address, or someone they chose on the control panel. Throws with a plain reason if it can't. */
export async function sendPersonalEmail(mcp: McpServersService | undefined, to: string | undefined, subject: string, body: string): Promise<void> {
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error(to ? `${to} doesn't look like an email address` : 'no email address set on the control panel');
  const found = selfEmailTool(mcp);
  if (!found) throw new Error('no email account connected (Connections → Apps: Gmail or Outlook)');
  const props = Object.keys((found.tool.type === 'function' ? (found.tool.function.parameters as { properties?: Record<string, unknown> })?.properties : undefined) ?? {});
  const key = (names: string[]) => names.find((n) => props.includes(n));
  const toKey = key(['recipient_email', 'to_email', 'to', 'recipient', 'to_address', 'email']);
  if (!toKey) throw new Error('the email action has no recipient field');
  const args: Record<string, unknown> = { [toKey]: to, [key(['subject', 'title']) ?? 'subject']: subject, [key(['body', 'message', 'content', 'text']) ?? 'body']: body };
  if (props.includes('is_html')) args.is_html = false;
  const name = found.tool.type === 'function' ? found.tool.function.name : '';
  const out = await found.server.call(name, args);
  if (/^error|"successful":\s*false|failed/i.test(out.slice(0, 200))) throw new Error(out.slice(0, 160));
}
