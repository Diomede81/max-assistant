import { Module } from '@nestjs/common';
import { AudioModule } from '../audio/audio.module';
import { WakeWordModule } from '../wake-word/wake-word.module';
import { SttModule } from '../stt/stt.module';
import { LlmModule } from '../llm/llm.module';
import { TtsModule } from '../tts/tts.module';
import { ActionsModule } from '../actions/actions.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ConversationService } from './conversation.service';

@Module({
  imports: [AudioModule, WakeWordModule, SttModule, LlmModule, TtsModule, ActionsModule, RealtimeModule],
  providers: [ConversationService],
})
export class ConversationModule {}
