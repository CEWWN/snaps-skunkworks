import type { EthereumRpcError } from 'eth-rpc-errors';
import { Json } from 'json-rpc-engine';
import { nanoid } from 'nanoid';
import { Caveat, GenericCaveat, ZcapLdCaveat } from './Caveat';

/**
 * The origin of a subject.
 * Effectively the GUID of an entity that can have permissions.
 */
export type OriginString = string;

/**
 * The name of a restricted method.
 */
export type MethodName = string;

/**
 * An interface
 */
type ZcapLdCapability = {
  /**
   * The context(s) in which this capability is meaningful.
   *
   * It is required by the standard, but we omit it because there is only one
   * context (the user's MetaMask instance).
   */
  readonly '@context'?: string[];

  /**
   * The cryptograhically strong GUID of the capability.
   */
  readonly id: string;

  /**
   * A pointer to the resource that possession of the capability grants
   * access to.
   *
   * In the context of MetaMask, this is always the name of an RPC method.
   */
  readonly parentCapability: string;

  /**
   * A pointer to the the entity that may invoke this capability.
   *
   * By the standard, this a link – usually some kind of URI – to a cryptographic
   * key that the proof of the `proof` field "must validate against".
   *
   * In the context of MetaMask, this is simply the origin of subject.
   */
  readonly invoker: string;

  /**
   * The issuing date, in UNIX epoch time.
   */
  readonly date?: number;

  /**
   * An array of caveat objects. See {@link ZcapLdCaveat}.
   *
   * TODO: Make optional in typescript@4.4.x
   */
  readonly caveats: ZcapLdCaveat[] | null;

  /**
   * The proof that this capability was delegated to the specified invoker.
   * By the standard, usually just a cryptographic signature of the capability
   * object, excluding this field.
   *
   * In MetaMask, the "proof" of validity is the existence of a valid capability
   * object in the designated part of our state tree, so this field is omitted.
   */
  readonly proof?: string;
};

export type PermissionOptions = {
  /**
   * The method that the permission corresponds to.
   */
  target: MethodName;

  /**
   * The origin string of the subject that has the permission.
   */
  invoker: OriginString;

  /**
   * The GUID of the permission object.
   * Assigned if not provided.
   */
  id?: string;

  /**
   * The caveats of the permission.
   * See {@link Caveat}.
   */
  caveats?: Caveat<string, Json>[];
};

/**
 * TODO: Document
 */
export type Permission = Omit<
  ZcapLdCapability,
  '@context' | 'caveats' | 'proof'
> & {
  /**
   * The GUID of the permission object.
   */
  readonly id: string;

  /**
   * The creation date of the permission, in UNIX epoch time.
   */
  readonly date: number;

  /**
   * The caveats of the permission.
   * @see Caveat
   *
   * TODO: Make optional in typescript@4.4.x
   */
  readonly caveats: Caveat<string, Json>[] | null;

  /**
   * The origin string of the subject that has the permission.
   */
  readonly invoker: OriginString;
};

/**
 * The default {@link Permission} factory function. Naively constructs a permission from
 * the inputs. Sets a default, random `id` if none is provided.
 *
 * @param options - The options for the permission.
 * @returns The new permission object.
 */
export function constructPermission(options: PermissionOptions) {
  const { caveats, id, invoker, target } = options;

  return {
    id: id ?? nanoid(),
    parentCapability: target,
    invoker,
    caveats: caveats ?? null,
    date: new Date().getTime(),
  };
}

/**
 * Gets the the caveat of the specified type belonging to the specified
 * permission.
 *
 * @param permission The permission whose caveat to retrieve.
 * @param caveatType The type of the caveat to retrieve.
 * @returns The caveat, or undefined if no such caveat exists.
 */
export function findCaveat<TargetCaveat extends Caveat<string, Json>>(
  permission: Permission,
  caveatType: TargetCaveat['type'],
): TargetCaveat | undefined {
  // TODO:types create a type for a permission that can have particular caveats?
  return permission.caveats?.find(
    (caveat) => caveat.type === caveatType,
  ) as any;
}

type RequestedPermission = {
  target?: MethodName;
  caveats?: Caveat<string, Json>[];
};

export type RequestedPermissions = Record<MethodName, RequestedPermission>;

export type RestrictedMethodContext = Readonly<{
  origin: OriginString;
  [key: string]: any;
}>;

// TODO: Should restricted methods just take (method, params, context) instead?
export type RestrictedMethodArgs<Params extends Json> = {
  method: string;
  params?: Params;
  context: RestrictedMethodContext;
};

export type SyncRestrictedMethodImplementation<
  Params extends Json,
  Result extends Json,
> = (
  args: RestrictedMethodArgs<Params>,
) => Result | Error | EthereumRpcError<Json>;

export type AsyncRestrictedMethodImplementation<
  Params extends Json,
  Result extends Json,
> = (
  args: RestrictedMethodArgs<Params>,
) => Promise<Result | Error | EthereumRpcError<Json>>;

export type RestrictedMethodImplementation<
  Params extends Json,
  Result extends Json,
> =
  | SyncRestrictedMethodImplementation<Params, Result>
  | AsyncRestrictedMethodImplementation<Params, Result>;

export type PermissionSpecification<
  TargetKey extends string,
  Perm extends PermConstraint<TargetKey, GenericCaveat | never>,
  FactoryOptions extends PermissionOptions,
  RequestData extends Record<string, unknown>,
  MethodImplementation extends RestrictedMethodImplementation<Json, Json>,
> = TargetKeyConstraint<TargetKey> extends never
  ? never
  : {
      /**
       * The target resource of the permission. In other words, at the time of
       * writing, the RPC method name.
       */
      target: TargetKey;

      /**
       * The factory function used to get permission objects. Permissions returned
       * by this function are presumed to valid, and they will not be passed to the
       * validator function associated with this specification (if any). In other
       * words, the factory function should validate the permissions it creates.
       *
       * If no factory is specified, the {@link Permission} constructor will be
       * used, and the validator function (if specified) will be called on newly
       * constructed permissions.
       */
      factory?: (options: FactoryOptions, requestData?: RequestData) => Perm;

      /**
       * The implementation of the restricted method that the permission
       * corresponds to.
       */
      methodImplementation: MethodImplementation;

      /**
       * The validator function used to validate permissions of the associated type
       * whenever they are mutated. The only way a permission can be legally mutated
       * is when its caveats are modified by the permission controller.
       *
       * The validator should throw an appropriate JSON-RPC error if validation fails.
       */
      validator?: (permission: Permission) => void;
    };

// export type PermissionSpecifications = Record<
//   MethodName,
//   PermissionSpecification<
//     string,
//     GenericPermission,
//     PermissionOptions,
//     Record<string, unknown>,
//     RestrictedMethodImplementation<Json, Json>
//   >
// >;

export type TargetKeyConstraint<Key extends string> = Key extends `${string}_*`
  ? Key
  : Key extends `${string}_`
  ? never
  : Key extends `${string}*`
  ? never
  : Key;

export type TargetNameConstraint<Name extends string> =
  Name extends `${string}*` ? never : Name extends `${string}_` ? never : Name;

// type NotWildCard<Name extends string> = Name extends `${string}*`
//   ? never
//   : Name;

export type ExtractPermissionTargetNames<TargetKey extends string> =
  TargetKey extends `${infer Base}_*` ? `${Base}_${string}` : TargetKey;

// type MyKeys = 'foo' | 'foo2' | 'bar_*' | 'excluded1_' | 'excluded2*';

// type MyConstrainedKeys = TargetKeyConstraint<MyKeys>

// type MyNames = TargetNameConstraint<ExtractPermissionTargetNames<MyConstrainedKeys>>;

// let foo: NotWildCard<'foo*'>;
// foo.

// let bar: PermConstraint<'foo*', any>;
// bar.

export type PermConstraint<
  TargetName extends string,
  AllowedCaveat extends GenericCaveat | never,
> = TargetNameConstraint<TargetName> extends never
  ? never
  : Omit<Permission, 'caveats' | 'parentCapability'> & {
      caveats: AllowedCaveat extends never ? null : AllowedCaveat[] | null;
      parentCapability: TargetName extends `${string}_`
        ? `${TargetName}${string}`
        : TargetName;
    };

export type GenericPermission = PermConstraint<string, GenericCaveat | never>;

export type PermSpec<TargetKey extends string> =
  TargetKeyConstraint<TargetKey> extends never
    ? never
    : PermissionSpecification<
        TargetKey,
        PermConstraint<TargetKey, GenericCaveat | never>,
        PermissionOptions,
        Record<string, unknown>,
        RestrictedMethodImplementation<Json, Json>
      >;

export type PermSpecs<TargetKey extends string> =
  TargetKeyConstraint<TargetKey> extends never
    ? never
    : Record<TargetKey, PermSpec<TargetKey>>;