import { Global, Module } from '@nestjs/common';
import { ModelsService } from './models.service';

/** Global: every background job asks it for its model. */
@Global()
@Module({ providers: [ModelsService], exports: [ModelsService] })
export class ModelsModule {}
