import { Module } from '@nestjs/common';
import { McpServersService } from './mcp-servers.service';

@Module({ providers: [McpServersService], exports: [McpServersService] })
export class McpModule {}
