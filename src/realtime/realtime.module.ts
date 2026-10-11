import { Module } from '@nestjs/common';
import { AudioModule } from '../audio/audio.module';
import { ActionsModule } from '../actions/actions.module';
import { TtsModule } from '../tts/tts.module';
import { WakeWordModule } from '../wake-word/wake-word.module';
import { RealtimeConversationService } from './realtime-conversation.service';

@Module({
  imports: [AudioModule, ActionsModule, TtsModule, WakeWordModule],
  providers: [RealtimeConversationService],
  exports: [RealtimeConversationService],
})
export class RealtimeModule {}
