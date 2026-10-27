import { Global, Module } from '@nestjs/common';
import { WakeWordService } from './wake-word.service';

/** Global so the conversation, the live voice and the control panel share the wake-word choice. */
@Global()
@Module({ providers: [WakeWordService], exports: [WakeWordService] })
export class WakeWordModule {}
