import { Global, Module } from '@nestjs/common';
import { MemoryModule } from '../memory/memory.module';
import { AboutService } from './about.service';

/** Global: the soul (prompt), Max's actions and the control panel all use it. */
@Global()
@Module({ imports: [MemoryModule], providers: [AboutService], exports: [AboutService] })
export class AboutModule {}
