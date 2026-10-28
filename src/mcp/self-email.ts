/**
 * Emailing the user themselves (health plans, scheduled task results) through the personal
 * account's Gmail or Outlook action. Never the work account, never anyone else's address.
 */
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { McpServersService } from './mcp-servers.service';
import { htmlToText } from '../mcp/compact';

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
export async function sendPersonalEmail(mcp: McpServersService | undefined, to: string | undefined, subject: string, body: string, html = false): Promise<EmailOutcome> {
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error(to ? `${to} doesn't look like an email address` : 'no email address set on the control panel');
  const found = selfEmailTool(mcp);
  if (!found) throw new Error('no email account connected (Connections → Apps: Gmail or Outlook)');
  const props = Object.keys((found.tool.type === 'function' ? (found.tool.function.parameters as { properties?: Record<string, unknown> })?.properties : undefined) ?? {});
  const key = (names: string[]) => names.find((n) => props.includes(n));
  const toKey = key(['recipient_email', 'to_email', 'to', 'recipient', 'to_address', 'email']);
  if (!toKey) throw new Error('the email action has no recipient field');
  const args: Record<string, unknown> = { [toKey]: to, [key(['subject', 'title']) ?? 'subject']: subject, [key(['body', 'message', 'content', 'text']) ?? 'body']: body };
  // HTML (a task asked to write a nicely laid-out email): sent as HTML where the action allows, else as text.
  if (props.includes('is_html')) args.is_html = html;
  else if (props.includes('body_type') || props.includes('content_type')) args[props.includes('body_type') ? 'body_type' : 'content_type'] = html ? 'html' : 'text';
  else if (html) args[key(['body', 'message', 'content', 'text']) ?? 'body'] = htmlToText(body);
  const name = found.tool.type === 'function' ? found.tool.function.name : '';
  const out = await found.server.call(name, args);
  const problem = emailProblem(out);
  if (problem) throw new Error(problem);
  return { confirmed: emailConfirmed(out), said: out.replace(/\s+/g, ' ').trim().slice(0, 300), via: name };
}

/** What a send returned: whether the app confirmed it, and what it said (for the panel and the log). */
export interface EmailOutcome {
  confirmed: boolean;
  said: string;
  /** The action used (GMAIL_SEND_EMAIL, OUTLOOK_SEND_EMAIL…). */
  via: string;
}

/** Did the app positively say the email went (not just "no error")? */
export function emailConfirmed(out: string): boolean {
  const text = out.trim();
  try {
    const data = JSON.parse(text) as { successful?: boolean; data?: Record<string, unknown> };
    if (data && typeof data === 'object') {
      if (data.successful === true) return true;
      const d = data.data ?? (data as Record<string, unknown>);
      return Boolean(d && typeof d === 'object' && ('id' in d || 'messageId' in d || 'message_id' in d || 'threadId' in d || 'response_data' in d));
    }
  } catch {
    // not JSON
  }
  return /\b(sent|message id|messageid|"id"\s*:)/i.test(text);
}

/** What went wrong according to the email app's answer, or undefined when it says the email went. */
export function emailProblem(out: string): string | undefined {
  const text = out.trim();
  try {
    const data = JSON.parse(text) as { successful?: boolean; error?: unknown; data?: { error?: unknown } };
    if (data && typeof data === 'object') {
      const err = data.error ?? data.data?.error;
      if (data.successful === false || (err && err !== 'null')) return `the email app said: ${typeof err === 'string' ? err : JSON.stringify(err ?? data).slice(0, 200)}`;
      return undefined;
    }
  } catch {
    // not JSON: read it as text
  }
  if (/"successful"\s*:\s*false|"error"\s*:\s*"[^"]|not connected|unauthori[sz]ed|invalid|expired|forbidden|quota|^error/i.test(text)) return `the email app said: ${text.slice(0, 200)}`;
  return undefined;
}

/** Does a result read as an HTML document or fragment (so it should go as an HTML email)? */
export function looksLikeHtml(text: string): boolean {
  const t = text.trim();
  return /^\s*(<!doctype html|<html|<body|<div|<table|<h[1-6]|<p\b)/i.test(t) || (/<\/(p|div|table|tr|li|h[1-6])>/i.test(t) && (t.match(/<[a-z][^>]*>/gi) ?? []).length >= 5);
}
