import { Global, Module } from '@nestjs/common';
import { WebService } from './web.service';

/** Global so the action router and the control panel share one Firecrawl client. */
@Global()
@Module({ providers: [WebService], exports: [WebService] })
export class WebModule {}
