import { Global, Module } from '@nestjs/common';
import { MemoryModule } from '../memory/memory.module';
import { MeetingsService } from './meetings.service';

/** Global: the control panel (and, later, Max's voice actions) use the same meetings. */
@Global()
@Module({ imports: [MemoryModule], providers: [MeetingsService], exports: [MeetingsService] })
export class MeetingsModule {}
