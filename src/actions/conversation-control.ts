import { Injectable } from '@nestjs/common';

/**
 * Lets the AI model end the current conversation (the end_conversation action): when the user
 * says they're done, or when what Max heard clearly wasn't said to him. The voice loops check it
 * after each reply and go quiet.
 */
@Injectable()
export class ConversationControl {
  private requested = false;

  requestEnd(): void {
    this.requested = true;
  }

  /** True once after end_conversation was called; resets itself. */
  consumeEnd(): boolean {
    const r = this.requested;
    this.requested = false;
    return r;
  }

  get endRequested(): boolean {
    return this.requested;
  }
}
