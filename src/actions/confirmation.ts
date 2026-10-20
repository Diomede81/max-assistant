/**
 * The spoken "yes" for risky actions (sending email, turning the box off, unlocking a door...),
 * checked by Max himself, not taken on the AI model's word.
 *
 * The model asks the user ("Shall I send it?") and calls the action again with confirmed=true. That
 * second call only goes through if the user actually answered: someone spoke after the question
 * was asked and, when the words are known, they were a yes and not a no. A "yes" can't come from
 * an email or a web page (it isn't the user speaking), nor from the model calling the action twice
 * in a row, or twice in the same batch.
 */

/** A clear yes ("yes", "go ahead", "send it"...). */
const YES = /\b(yes|yeah|yep|yup|yea|sure|ok|okay|alright|all right|go ahead|go on|go for it|do it|send it|join it|proceed|confirm|confirmed|please do|yes please|correct|absolutely|of course|definitely|sounds good|perfect|that'?s right|si|sì)\b/i;
/** Any sign of a no or a change, which wins over a yes ("yes, actually no", "send it to John instead"). */
const NO = /\b(no|nope|don'?t|do not|cancel|stop|wait|hold on|never ?mind|not yet|not now|instead|change|actually)\b/i;

export const isYes = (t: string) => YES.test(t) && !NO.test(t);

/** How long a question waits for its answer. */
const WINDOW_MS = 3 * 60_000;
/**
 * The answer's words can arrive a moment after the model acts on them (real-time voice: Gemini's transcript of what the
 * user said often trails by a few seconds): wait this long for them.
 */
const WORDS_WAIT_MS = 5000;

export type Verdict = 'yes' | 'no' | 'unclear' | 'no-answer' | 'not-asked';

export class ConfirmationGate {
  private readonly asked = new Map<string, number>();
  /** When the user last started or finished speaking, and the last words heard (with when). */
  private spokeAt = 0;
  private words = { text: '', at: 0 };
  private waiting: (() => void)[] = [];

  /** The user is speaking (real-time voice: speech started), words maybe still to come. */
  userSpoke(): void {
    this.spokeAt = Date.now();
  }

  /** The user's words (a full sentence, or the part heard so far). */
  heard(text: string): void {
    if (!text.trim()) return;
    this.spokeAt = Date.now();
    this.words = { text, at: Date.now() };
    for (const w of this.waiting.splice(0)) w();
  }

  /** The model asked the user about this action (key = action + its exact details). */
  ask(key: string): void {
    this.asked.set(key, Date.now());
    for (const [k, at] of this.asked) if (Date.now() - at > WINDOW_MS) this.asked.delete(k);
  }

  isAsked(key: string): boolean {
    const at = this.asked.get(key);
    return at !== undefined && Date.now() - at <= WINDOW_MS;
  }

  forget(key: string): void {
    this.asked.delete(key);
  }

  /**
   * Did the user say yes to this question? `wordsKnown`: false when only the fact that they spoke
   * is known (real-time voice without transcription): then speaking after the question counts.
   */
  async answer(key: string, wordsKnown = true): Promise<Verdict> {
    const askedAt = this.asked.get(key);
    if (askedAt === undefined || Date.now() - askedAt > WINDOW_MS) return 'not-asked';
    const deadline = Date.now() + WORDS_WAIT_MS;
    // Words since the question that clearly say yes or no: decided. Otherwise wait a moment for more
    // (they can trail the model's action, and arrive a piece at a time).
    const decided = () => this.words.at > askedAt && (YES.test(this.words.text) || NO.test(this.words.text));
    while (!decided() && Date.now() < deadline) {
      if (!wordsKnown && this.spokeAt > askedAt) break;
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, deadline - Date.now());
        this.waiting.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    if (this.words.at > askedAt) return NO.test(this.words.text) ? 'no' : YES.test(this.words.text) ? 'yes' : 'unclear';
    if (this.spokeAt > askedAt) return wordsKnown ? 'unclear' : 'yes';
    return 'no-answer';
  }

  /** The last words heard (for the log and the model's message). */
  get lastWords(): string {
    return this.words.text;
  }
}
