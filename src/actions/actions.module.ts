import { Module } from '@nestjs/common';
import { HaMcpModule } from '../ha-mcp/ha-mcp.module';
import { McpModule } from '../mcp/mcp.module';
import { ComposioModule } from '../composio/composio.module';
import { BuiltinActionsService } from './builtin-actions.service';
import { TimerService } from './timer.service';
import { ToolRouterService } from './tool-router.service';

@Module({
  imports: [HaMcpModule, McpModule, ComposioModule],
  providers: [TimerService, BuiltinActionsService, ToolRouterService],
  exports: [TimerService, BuiltinActionsService, ToolRouterService],
})
export class ActionsModule {}
