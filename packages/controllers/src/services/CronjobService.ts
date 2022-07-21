import {
  RestrictedControllerMessenger,
  HasPermission,
  GetPermissions,
} from '@metamask/controllers';
import { SnapId } from '@metamask/snap-types';
import { parseExpression } from 'cron-parser';
import { nanoid } from 'nanoid';
import {
  GetSnap,
  HandleSnapCronjobRequest,
  SnapAdded,
  SnapEndowments,
} from '..';
import { Timer } from '../snaps/Timer';

export type CronjobServiceActions =
  | GetSnap
  | HandleSnapCronjobRequest
  | HasPermission
  | GetPermissions;

export type CronjobServiceEvents = SnapAdded;

export type CronjobServiceMessenger = RestrictedControllerMessenger<
  'CronjobService',
  CronjobServiceActions,
  CronjobServiceEvents,
  CronjobServiceActions['type'],
  CronjobServiceEvents['type']
>;

export type CronjobServiceArgs = {
  messenger: CronjobServiceMessenger;
};

export type CronjobData = {
  jobs: Cronjob[];
};

export type CronjobDefinition = {
  expression: string;
  request: Record<string, unknown>;
};

export type Cronjob = {
  timer?: Timer;
  id: string;
} & CronjobDefinition;

export class CronjobService {
  private _messenger: CronjobServiceMessenger;

  private _snaps: Map<SnapId, string[]>;

  private _jobs: Map<string, Cronjob>;

  constructor({ messenger }: CronjobServiceArgs) {
    this._snaps = new Map();
    this._jobs = new Map();
    this._messenger = messenger;
  }

  async register(snapId: SnapId) {
    const hasCronjob = await this._messenger.call(
      'PermissionController:hasPermission',
      snapId,
      SnapEndowments.cronjob,
    );
    if (!hasCronjob) {
      return;
    }
    const permissions = await this._messenger.call(
      'PermissionController:getPermissions',
      snapId,
    );
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const cronjobPermission = permissions![SnapEndowments.cronjob]!;
    // @todo Figure out how to get this from the permission
    const definitions: CronjobDefinition[] = (cronjobPermission as any).jobs;

    const jobs = definitions.map((definition) => {
      const id = nanoid();
      return { ...definition, id };
    });

    this._snaps.set(
      snapId,
      jobs.map((job) => job.id),
    );

    jobs.forEach((job) => this.schedule(snapId, job));
  }

  unregister(snapId: SnapId) {
    const jobs = this._snaps.get(snapId);
    jobs?.forEach((id) => {
      const job = this._jobs.get(id);
      job?.timer?.cancel();
    });
    this._snaps.delete(snapId);
  }

  schedule(snapId: SnapId, job: Cronjob) {
    const parsed = parseExpression(job.expression);
    if (!parsed.hasNext()) {
      return;
    }
    const next = parsed.next();
    const now = new Date();
    const ms = now.getTime() - next.getTime();
    const timer = new Timer(ms);
    timer.start(() => {
      this._messenger.call(
        'SnapController:handleCronjobRequest',
        snapId,
        // @todo Decide on origin for requests like this
        'METAMASK',
        job.request,
      );
      this.schedule(snapId, job);
    });
    this._jobs.set(job.id, { ...job, timer });
  }
}
