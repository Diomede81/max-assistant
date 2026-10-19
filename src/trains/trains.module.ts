import { Global, Module } from '@nestjs/common';
import { TrainsService } from './trains.service';

/** Global so the action router and the control panel share one trains service. */
@Global()
@Module({ providers: [TrainsService], exports: [TrainsService] })
export class TrainsModule {}
