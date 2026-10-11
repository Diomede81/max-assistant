import { Module } from '@nestjs/common';
import { ActionsModule } from '../actions/actions.module';
import { LlmService } from './llm.service';

@Module({ imports: [ActionsModule], providers: [LlmService], exports: [LlmService] })
export class LlmModule {}
