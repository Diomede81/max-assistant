import { Global, Module } from '@nestjs/common';
import { MemoryModule } from '../memory/memory.module';
import { LocationService } from './location.service';

/** Global: the soul (prompt), web search and the control panel all use it. */
@Global()
@Module({ imports: [MemoryModule], providers: [LocationService], exports: [LocationService] })
export class LocationModule {}
