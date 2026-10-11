import { Module } from '@nestjs/common';
import { McpModule } from '../mcp/mcp.module';
import { ComposioService } from './composio.service';

@Module({ imports: [McpModule], providers: [ComposioService], exports: [ComposioService] })
export class ComposioModule {}
