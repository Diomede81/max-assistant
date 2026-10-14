import { Global, Module } from '@nestjs/common';
import { MemoryModule } from '../memory/memory.module';
import { RoutinesService } from './routines.service';

/** Global: the action router, "my day" and the control panel all use it. */
@Global()
@Module({ imports: [MemoryModule], providers: [RoutinesService], exports: [RoutinesService] })
export class RoutinesModule {}
