import {
  PermissionSpecificationBuilder,
  PermissionType,
  EndowmentGetterParams,
  ValidPermissionSpecification,
} from '@metamask/controllers';
import { SnapEndowments } from './enum';

const permissionName = SnapEndowments.cronjob;

type CronjobEndowmentSpecification = ValidPermissionSpecification<{
  permissionType: PermissionType.Endowment;
  targetKey: typeof permissionName;
  endowmentGetter: (_options?: any) => undefined;
  allowedCaveats: null;
}>;

/**
 * `endowment:cronjob` returns nothing; it is intended to be used as a flag to determine whether the snap wants to run cronjobs.
 *
 * @param _builderOptions - Optional specification builder options.
 * @returns The specification for the cronjob endowment.
 */
const specificationBuilder: PermissionSpecificationBuilder<
  PermissionType.Endowment,
  any,
  CronjobEndowmentSpecification
> = (_builderOptions?: any) => {
  return {
    permissionType: PermissionType.Endowment,
    targetKey: permissionName,
    // @todo not allowed by types?
    allowedCaveats: ['cronjobCaveat'] as any,
    endowmentGetter: (_getterOptions?: EndowmentGetterParams) => undefined,
  };
};

export const cronjobEndowmentBuilder = Object.freeze({
  targetKey: permissionName,
  specificationBuilder,
} as const);
