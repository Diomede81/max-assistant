import { Module } from '@nestjs/common';
import { ComposioModule } from '../composio/composio.module';
import { HaMcpModule } from '../ha-mcp/ha-mcp.module';
import { HomeModule } from '../home/home.module';
import { McpModule } from '../mcp/mcp.module';
import { MemoryModule } from '../memory/memory.module';
import { ControlPanelService } from './control-panel.service';

@Module({ imports: [ComposioModule, HaMcpModule, HomeModule, McpModule, MemoryModule], providers: [ControlPanelService] })
export class ControlPanelModule {}
