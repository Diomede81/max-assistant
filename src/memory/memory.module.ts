import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { MemoryLearnerService } from './memory-learner.service';
import { ModesService } from './modes.service';
import { EmbedderService } from './embedder.service';

@Module({
  providers: [ModesService, EmbedderService, MemoryService, MemoryLearnerService],
  exports: [ModesService, MemoryService, MemoryLearnerService],
})
export class MemoryModule {}
