import { Global, Module } from '@nestjs/common';
import { ActionsModule } from '../actions/actions.module';
import { FaceService } from './face.service';
import { FaceServer } from './face.server';

/** Global so the speaker and both conversation modes can report to the face. */
@Global()
@Module({ imports: [ActionsModule], providers: [FaceService, FaceServer], exports: [FaceService] })
export class FaceModule {}
