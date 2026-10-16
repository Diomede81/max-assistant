import { Global, Module } from '@nestjs/common';
import { AudioModule } from '../audio/audio.module';
import { LiveVoiceService } from './live-voice.service';

/** Global: the conversation (greeting, voice), the real-time session and the control panel use it. */
@Global()
@Module({ imports: [AudioModule], providers: [LiveVoiceService], exports: [LiveVoiceService] })
export class LiveVoiceModule {}
