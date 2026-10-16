import { TokenserverRefusedError } from './tokenserver-refusal';

/** What the request claims. Zero values arrive as `null`. */
export interface IRequestKeys {
  generation: number | null;
  keysChangedAt: number | null;
  clientState: string;
}

export interface ICurrentUser {
  uid: number;
  /** Zero until a generation is reported. */
  generation: number;
  keysChangedAt: number | null;
  clientState: string;
  /** Client states of the user's earlier rows that differ from the current one. */
  oldClientStates: string[];
}

export interface IUserKeys {
  generation: number;
  keysChangedAt: number | null;
}

/** The generation of a deleted account's rows; `validateRequestKeys` refuses every request against it. */
export const RETIRED_GENERATION = Number.MAX_SAFE_INTEGER;

// syncstorage-rs `opt_cmp!`: a comparison with a missing side is false.
const greater = (left: number | null, right: number | null): boolean => left !== null && right !== null && left > right;
const less = (left: number | null, right: number | null): boolean => left !== null && right !== null && left < right;
const atMost = (left: number | null, right: number | null): boolean => left !== null && right !== null && left <= right;

/**
 * Rejects a request whose keys contradict what the user already reported, in syncstorage-rs's order so the same
 * error wins (`TokenserverRequest::validate`, `syncserver/src/tokenserver/extractors.rs`).
 */
export function validateRequestKeys(request: IRequestKeys, user: ICurrentUser): void {
  // A token without a generation claim would pass the generation rule below, so a retired account is refused first.
  if (user.generation === RETIRED_GENERATION) {
    throw new TokenserverRefusedError({ reason: 'invalid-generation' });
  }

  const clientStateChanged = request.clientState !== user.clientState;

  if (greater(request.keysChangedAt, user.keysChangedAt) && less(request.generation, request.keysChangedAt)) {
    throw new TokenserverRefusedError({ reason: 'invalid-keys-changed-at' });
  }

  if (user.clientState !== '' && request.clientState === '') {
    throw new TokenserverRefusedError({ reason: 'empty-client-state' });
  }

  if (user.oldClientStates.includes(request.clientState)) {
    throw new TokenserverRefusedError({ reason: 'stale-client-state' });
  }

  if (clientStateChanged && atMost(request.generation, user.generation)) {
    throw new TokenserverRefusedError({ reason: 'client-state-without-generation-change' });
  }

  if (clientStateChanged && atMost(request.keysChangedAt, user.keysChangedAt)) {
    throw new TokenserverRefusedError({ reason: 'client-state-without-keys-changed-at-change' });
  }

  if (greater(user.generation, request.generation)) {
    throw new TokenserverRefusedError({ reason: 'invalid-generation' });
  }

  if (greater(user.keysChangedAt, request.keysChangedAt)) {
    throw new TokenserverRefusedError({ reason: 'invalid-keys-changed-at' });
  }

  if (request.keysChangedAt === null && user.keysChangedAt !== null && user.keysChangedAt !== 0) {
    throw new TokenserverRefusedError({ reason: 'invalid-keys-changed-at' });
  }
}

/**
 * The user's keys after a validated request (syncstorage-rs `update_user`, `syncserver/src/tokenserver/handlers.rs`).
 * Without a reported generation, a raised keys_changed_at stands in for one.
 */
export function nextUserKeys(request: IRequestKeys, user: ICurrentUser): IUserKeys {
  const keysChangedAt = request.keysChangedAt ?? user.keysChangedAt;

  if (request.generation !== null) {
    return { generation: Math.max(request.generation, user.generation), keysChangedAt };
  }

  const keysChangedAtRaised =
    request.keysChangedAt !== null && (user.keysChangedAt === null || request.keysChangedAt > user.keysChangedAt);

  const generation =
    keysChangedAtRaised && request.keysChangedAt !== null && request.keysChangedAt > user.generation
      ? request.keysChangedAt
      : user.generation;

  return { generation, keysChangedAt };
}
