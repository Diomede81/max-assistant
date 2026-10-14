import { Module } from '@nestjs/common';
import { HaMcpModule } from '../ha-mcp/ha-mcp.module';
import { McpModule } from '../mcp/mcp.module';
import { ComposioModule } from '../composio/composio.module';
import { MemoryModule } from '../memory/memory.module';
import { BuiltinActionsService } from './builtin-actions.service';
import { TimerService } from './timer.service';
import { ToolRouterService } from './tool-router.service';
import { ConversationControl } from './conversation-control';
import { ScreenToolsService } from './screen-tools.service';

@Module({
  imports: [HaMcpModule, McpModule, ComposioModule, MemoryModule],
  providers: [TimerService, BuiltinActionsService, ToolRouterService, ConversationControl, ScreenToolsService],
  exports: [TimerService, BuiltinActionsService, ToolRouterService, ConversationControl, ScreenToolsService, MemoryModule],
})
export class ActionsModule {}
