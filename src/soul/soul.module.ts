import { Global, Module } from '@nestjs/common';
import { MemoryModule } from '../memory/memory.module';
import { SoulService } from './soul.service';

/** Global so the AI model, the voice modes, the memory filer and the panel can all reach it. */
@Global()
@Module({ imports: [MemoryModule], providers: [SoulService], exports: [SoulService] })
export class SoulModule {}
