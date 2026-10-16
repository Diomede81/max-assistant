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
/** "Thank you", "great, thanks", "thank you very much", "perfect, thanks Max"... (short, nothing else asked). */
const THANKS = /^((ok|okay|oh|great|perfect|lovely|brilliant|cool|nice|awesome|fantastic|wonderful|excellent|good|right|alright|fine|super|that s great|that s perfect|that s all|that s it|thats great|thats perfect|thats all|thats it|all good|got it|no) )*(thanks|thank you|thankyou|cheers|ta)( (so|very) much| a lot| a million| again| for that| for your help| max| mate)*$/;

/** A thank-you anywhere in what was said: in the household's experience it nearly always means "we're done". */
const THANKS_ANYWHERE = /\b(thank you|thanks|thankyou|cheers)\b/;
/** ...except when the thank-you is what's being asked about: "send a thank-you email", "how do I say thank you". */
const THANKS_AS_TOPIC =
  /\b(thank you|thanks|thankyou) (email|e mail|note|card|message|letter|text|gift|present|speech|video)\b|\b(say|saying|said|write|writing|send|sending|translate|spell)( a| the| my| them| him| her| it| an)? (thank you|thanks|thankyou)\b/;
/** ...or when a new request follows it: "thanks, can you also...", "thanks, but that's wrong", "thanks, what about tomorrow?". */
const REQUEST_AFTER_THANKS =
  /\b(thank you|thanks|thankyou|cheers)\b.*\b(can you|could you|would you|will you|can i|could i|please|whats|hows|whos|wheres|(what|how|when|where|who|why|which) (about|is|are|was|were|will|would|do|does|did|should|can|could|time|much|many|long|far|if)|is it|are there|set|add|remind|tell|play|turn|send|call|open|show|find|check|read|book|also|another|one more|but|however|wait|actually|i want|i need|i meant|instead|now)\b/;

export function isStopRequest(text: string): boolean {
  let t = text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return false;
  if (THANKS_ANYWHERE.test(t) && !THANKS_AS_TOPIC.test(t) && !REQUEST_AFTER_THANKS.test(t)) return true;
  if (t.split(' ').length > 7) return false;
  t = t.replace(WAKE_WORDS, '').trim();
  if (THANKS.test(t)) return true;
  for (let i = 0; i < 2 && !STOP.has(t); i++) t = t.replace(POLITE, '').trim(); // "stop please max"
  return STOP.has(t) || STOP.has(t.replace(/^(ok|okay|no|oh|alright) /, ''));
}
