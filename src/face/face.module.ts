import { Global, Module } from '@nestjs/common';
import { ActionsModule } from '../actions/actions.module';
import { McpModule } from '../mcp/mcp.module';
import { WeatherService } from '../weather/weather.service';
import { AmbientService } from './ambient.service';
import { NotifyService } from './notify.service';
import { FaceService } from './face.service';
import { FaceServer } from './face.server';

/** Global so the speaker and both conversation modes can report to the face. */
@Global()
@Module({
  imports: [ActionsModule, McpModule],
  providers: [FaceService, FaceServer, WeatherService, AmbientService, NotifyService],
  exports: [FaceService, WeatherService, AmbientService],
})
export class FaceModule {}
