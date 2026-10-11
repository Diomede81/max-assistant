import { Module } from '@nestjs/common';
import { AudioModule } from '../audio/audio.module';
import { WakeWordModule } from '../wake-word/wake-word.module';
import { SttModule } from '../stt/stt.module';
import { LlmModule } from '../llm/llm.module';
import { TtsModule } from '../tts/tts.module';
import { ConversationService } from './conversation.service';

@Module({
  imports: [AudioModule, WakeWordModule, SttModule, LlmModule, TtsModule],
  providers: [ConversationService],
})
export class ConversationModule {}
