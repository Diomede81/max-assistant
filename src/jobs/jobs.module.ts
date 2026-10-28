import { Global, Module } from '@nestjs/common';
import { ActionsModule } from '../actions/actions.module';
import { McpModule } from '../mcp/mcp.module';
import { MemoryModule } from '../memory/memory.module';
import { JobsService } from './jobs.service';

/** Global: the control panel and the action router both use it. */
@Global()
@Module({ imports: [ActionsModule, McpModule, MemoryModule], providers: [JobsService], exports: [JobsService] })
export class JobsModule {}
