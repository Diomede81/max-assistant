import { Global, Module } from '@nestjs/common';
import { DeviceService } from './device.service';

/** Global: the screen's menu, the voice actions and the control panel all use it. */
@Global()
@Module({ providers: [DeviceService], exports: [DeviceService] })
export class DeviceModule {}
