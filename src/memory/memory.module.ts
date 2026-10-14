import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { MemoryLearnerService } from './memory-learner.service';
import { ModesService } from './modes.service';
import { EmbedderService } from './embedder.service';
import { MemoryDigestService } from './memory-digest.service';
import { ProjectsService } from './projects.service';
import { TodoService } from './todo.service';

@Module({
  providers: [ModesService, EmbedderService, MemoryService, MemoryLearnerService, MemoryDigestService, ProjectsService, TodoService],
  exports: [ModesService, MemoryService, MemoryLearnerService, MemoryDigestService, ProjectsService, TodoService],
})
export class MemoryModule {}
