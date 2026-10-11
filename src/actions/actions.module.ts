import { Module } from '@nestjs/common';
import { BuiltinActionsService } from './builtin-actions.service';
import { TimerService } from './timer.service';

@Module({ providers: [TimerService, BuiltinActionsService], exports: [TimerService, BuiltinActionsService] })
export class ActionsModule {}
