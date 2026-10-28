import { Global, Module } from '@nestjs/common';
import { ActionsModule } from '../actions/actions.module';
import { McpModule } from '../mcp/mcp.module';
import { MemoryModule } from '../memory/memory.module';
import { JournalService } from './journal.service';

/** Global: the action router, the daily briefing and the control panel all use it. */
@Global()
@Module({ imports: [ActionsModule, McpModule, MemoryModule], providers: [JournalService], exports: [JournalService] })
export class JournalModule {}
