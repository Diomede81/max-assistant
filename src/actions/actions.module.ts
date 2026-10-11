import { Module } from '@nestjs/common';
import { HaMcpModule } from '../ha-mcp/ha-mcp.module';
import { BuiltinActionsService } from './builtin-actions.service';
import { TimerService } from './timer.service';
import { ToolRouterService } from './tool-router.service';

@Module({
  imports: [HaMcpModule],
  providers: [TimerService, BuiltinActionsService, ToolRouterService],
  exports: [TimerService, BuiltinActionsService, ToolRouterService],
})
export class ActionsModule {}
