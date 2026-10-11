import { Module } from '@nestjs/common';
import { HaMcpModule } from '../ha-mcp/ha-mcp.module';
import { ActionsModule } from '../actions/actions.module';
import { LlmService } from './llm.service';

@Module({ imports: [HaMcpModule, ActionsModule], providers: [LlmService], exports: [LlmService] })
export class LlmModule {}
