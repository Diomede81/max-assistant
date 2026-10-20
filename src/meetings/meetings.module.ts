import { Global, Module } from '@nestjs/common';
import { MemoryModule } from '../memory/memory.module';
import { TtsModule } from '../tts/tts.module';
import { MeetingsService } from './meetings.service';
import { MeetingLiveService } from './meeting-live.service';

/** Global: the control panel (and, later, Max's voice actions) use the same meetings. */
@Global()
@Module({ imports: [MemoryModule, TtsModule], providers: [MeetingsService, MeetingLiveService], exports: [MeetingsService, MeetingLiveService] })
export class MeetingsModule {}
