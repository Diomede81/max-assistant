import { Module } from '@nestjs/common';
import { HaMcpModule } from '../ha-mcp/ha-mcp.module';
import { McpModule } from '../mcp/mcp.module';
import { ComposioModule } from '../composio/composio.module';
import { MemoryModule } from '../memory/memory.module';
import { BuiltinActionsService } from './builtin-actions.service';
import { TimerService } from './timer.service';
import { ToolRouterService } from './tool-router.service';
import { ConversationControl } from './conversation-control';

@Module({
  imports: [HaMcpModule, McpModule, ComposioModule, MemoryModule],
  providers: [TimerService, BuiltinActionsService, ToolRouterService, ConversationControl],
  exports: [TimerService, BuiltinActionsService, ToolRouterService, ConversationControl, MemoryModule],
})
export class ActionsModule {}
