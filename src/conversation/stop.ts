/**
 * "Stop", "that's all", "never mind", "I'm not talking to you"... Said on its own (not "stop the
 * music"), it ends the conversation at once: Max goes quiet and back to waiting for the wake word,
 * without asking the AI model.
 */
const PHRASES = [
  'stop', 'stop it', 'stop talking', 'stop now', 'just stop', 'please stop', 'stop stop',
  'quiet', 'be quiet', 'shush', 'shh', 'hush', 'shut up', 'silence', 'enough', "that's enough",
  "that's all", "that's it", 'that is all', 'all good', "i'm done", 'done', "we're done",
  'never mind', 'nevermind', 'forget it', 'forget about it', 'cancel', 'cancel that',
  'go to sleep', 'go away', 'goodbye', 'bye', 'bye bye', 'see you', 'good night',
  'thanks', 'thank you', 'cheers', 'ok thanks', 'ok thank you', 'no thanks', 'no thank you', 'nothing',
  'not you', "i'm not talking to you", "i wasn't talking to you", 'not talking to you', "wasn't talking to you",
  'talking to someone else', "i'm talking to someone else",
];
const STOP = new Set(PHRASES.map((p) => p.replace(/'/g, '')));
const WAKE_WORDS = /^(hey |hi |ok |okay )?(max|maxie|jarvis)\b ?/;
const POLITE = /\b(please|thanks|thank you|max|now)$/;

export function isStopRequest(text: string): boolean {
  let t = text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.split(' ').length > 7) return false;
  t = t.replace(WAKE_WORDS, '').trim();
  for (let i = 0; i < 2 && !STOP.has(t); i++) t = t.replace(POLITE, '').trim(); // "stop please max"
  return STOP.has(t) || STOP.has(t.replace(/^(ok|okay|no|oh|alright) /, ''));
}
