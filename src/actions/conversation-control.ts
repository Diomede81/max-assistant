import { Injectable } from '@nestjs/common';

/**
 * Lets the AI model end the current conversation (the end_conversation action): when the user
 * says they're done, or when what Max heard clearly wasn't said to him. The voice loops check it
 * after each reply and go quiet.
 */
@Injectable()
export class ConversationControl {
  private requested = false;
  private afterReply = false;

  requestEnd(): void {
    this.requested = true;
  }

  /**
   * End once Max has answered (e.g. music just started: he confirms it in a few words, then goes
   * quiet so the user can listen, without having to say "stop").
   */
  requestEndAfterReply(): void {
    this.afterReply = true;
  }

  /** True once after end_conversation was called; resets itself. */
  consumeEnd(): boolean {
    const r = this.requested;
    this.requested = false;
    return r;
  }

  /** True once after requestEndAfterReply; resets itself. */
  consumeEndAfterReply(): boolean {
    const r = this.afterReply;
    this.afterReply = false;
    return r;
  }

  /** A new conversation: nothing left over from the last one. */
  reset(): void {
    this.requested = false;
    this.afterReply = false;
  }

  get endRequested(): boolean {
    return this.requested;
  }
}
