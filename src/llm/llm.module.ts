import { Module } from '@nestjs/common';
import { HaMcpModule } from '../ha-mcp/ha-mcp.module';
import { LlmService } from './llm.service';

@Module({ imports: [HaMcpModule], providers: [LlmService], exports: [LlmService] })
export class LlmModule {}
