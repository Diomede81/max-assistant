import { Global, Module } from '@nestjs/common';
import { MemoryModule } from '../memory/memory.module';
import { SocialService } from './social.service';

/** Global: the action router, the daily briefing and the control panel all use it. */
@Global()
@Module({ imports: [MemoryModule], providers: [SocialService], exports: [SocialService] })
export class SocialModule {}
