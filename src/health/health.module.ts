import { Global, Module } from '@nestjs/common';
import { McpModule } from '../mcp/mcp.module';
import { HealthService } from './health.service';

/** Global so the action router and the control panel share one Health section. */
@Global()
@Module({ imports: [McpModule], providers: [HealthService], exports: [HealthService] })
export class HealthModule {}
