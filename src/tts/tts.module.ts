import { Module } from '@nestjs/common';
import { AudioModule } from '../audio/audio.module';
import { TtsService } from './tts.service';

@Module({ imports: [AudioModule], providers: [TtsService], exports: [TtsService] })
export class TtsModule {}
