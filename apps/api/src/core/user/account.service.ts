import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';

import { UserRoleId } from '@libs/dto';

import { KeyFetchToken } from './entities/key-fetch-token.entity';
import { PasswordChangeToken } from './entities/password-change-token.entity';
import { IOnepwCredentials, User } from './entities/user.entity';
import { PasswordReset } from './password-reset/entities/password-reset.entity';
import { Invite } from '@/core/invite/entities/invite.entity';
import { Session } from '@/core/session/entities/session.entity';

import { PasswordResetService } from './password-reset/password-reset.service';
import { UserService } from './user.service';
import { InviteService } from '@/core/invite/invite.service';
import { IResolvedSession, SessionService } from '@/core/session/session.service';
import { TokenserverService } from '@/core/tokenserver/tokenserver.service';

import { AccountRefusal, AccountRefusedError } from './account-refusal';
import { bundleKeys, checkAuthPw, createCredentials, unwrapWrapKb } from './onepw';
import { PasswordResetRefusedError } from './password-reset/password-reset-refusal';
import { hashToken, randomHex } from '@/common/secret-token';
import { deriveTokenId, readTokenId } from '@/core/session/token-credentials';

export interface INewAccount {
  email: string;
  authPw: string;
  wrapKb: string;
  clientSalt: string;
  inviteToken: string;
}

export interface ISignIn {
  user: User;
  session: Session;
  /** The session token seed, returned to the client once and never stored. */
  sessionToken: string;
  keyFetchToken: string | null;
}

export interface IPasswordChangeStart {
  keyFetchToken: string;
  passwordChangeToken: string;
}

export interface INewPassword {
  authPw: string;
  wrapKb: string;
  clientSalt: string;
  /** The session the change is made from, which must belong to the account. */
  sessionTokenId: string;
}

export interface IPasswordReset {
  resetToken: string;
  authPw: string;
  clientSalt: string;
}

interface INewCredentials {
  authPw: string;
  clientSalt: string;
  /** The client's kB wrapped under the new password, kept as is; `null` re-keys the account. */
  wrapKb: string | null;
}

interface ICredentialChange extends IOnepwCredentials {
  verifierSetAt: number;
  mustChangePassword: false;
  kA?: string;
  keysChangedAt?: number;
}

const KEY_FETCH_TOKEN_LIFETIME_MS = 10 * 60 * 1000;

// fxa-auth-server/config/index.ts tokenLifetimes.passwordChangeToken
const PASSWORD_CHANGE_TOKEN_LIFETIME_MS = 15 * 60 * 1000;

const ADMIN_ROLES = [UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN];

@Injectable()
export class AccountService {
  constructor(
    private readonly inviteService: InviteService,
    private readonly passwordResetService: PasswordResetService,
    private readonly sessionService: SessionService,
    private readonly tokenserverService: TokenserverService,
    private readonly userService: UserService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(KeyFetchToken)
    private readonly keyFetchTokenRepository: Repository<KeyFetchToken>,
    @InjectRepository(PasswordChangeToken)
    private readonly passwordChangeTokenRepository: Repository<PasswordChangeToken>
  ) {}

  /** Admitted only by an invite for the same address. */
  async create(
    account: INewAccount,
    withKeys: boolean,
    locale: string | null,
    userAgent: string | null
  ): Promise<ISignIn> {
    const invite = await this.inviteService.findValid(account.inviteToken);

    if (invite === null || !this.inviteService.admits(invite, account.email)) {
      throw new AccountRefusedError({ reason: 'invalid-invite' });
    }

    if ((await this.findByEmail(account.email)) !== null) {
      throw new AccountRefusedError({ reason: 'account-exists', email: account.email });
    }

    // scrypt runs before the transaction: better-sqlite3 has one connection, so an open transaction spans every
    // request served meanwhile.
    const user = new User({
      uid: randomHex(16),
      name: invite.name,
      email: account.email,
      locale,
      kA: randomHex(32),
      credentials: await createCredentials(account.authPw, account.wrapKb, account.clientSalt),
      now: Date.now(),
    });

    await this.insertInvitedUser(user, invite);

    return this.signIn(user, withKeys ? Buffer.from(account.wrapKb, 'hex') : null, userAgent);
  }

  /** `requireFinishedSetup` refuses an account still held to first-time setup, once its password has matched. */
  async login(
    email: string,
    authPw: string,
    withKeys: boolean,
    userAgent: string | null,
    requireFinishedSetup: boolean
  ): Promise<ISignIn> {
    const user = await this.findByEmail(email);

    if (user === null) {
      throw new AccountRefusedError({ reason: 'unknown-account', email });
    }

    if (!user.enabled) {
      throw new AccountRefusedError({ reason: 'account-disabled' });
    }

    const stretched = await checkAuthPw(authPw, user);

    if (stretched === null) {
      await this.userRepository.update({ id: user.id }, { lastLoginFail: new Date() });

      throw new AccountRefusedError(this.incorrectPassword(user, email));
    }

    if (requireFinishedSetup && user.mustChangePassword) {
      throw new AccountRefusedError({ reason: 'setup-required' });
    }

    const signIn = await this.signIn(
      user,
      withKeys ? unwrapWrapKb(user.wrapWrapKb, stretched.wrapwrapKey) : null,
      userAgent
    );

    await this.userRepository.update({ id: user.id }, { lastLoginSuccess: new Date() });

    return signIn;
  }

  /**
   * Checks the current password and hands out a keyFetchToken for the current wrapKb and a passwordChangeToken
   * (fxa-auth-server/lib/routes/password.ts `/password/change/start`).
   */
  async startPasswordChange(
    { user }: IResolvedSession,
    email: string,
    oldAuthPw: string
  ): Promise<IPasswordChangeStart> {
    if (email.toLowerCase() !== user.normalizedEmail) {
      throw new AccountRefusedError(this.incorrectPassword(user, email));
    }

    const stretched = await checkAuthPw(oldAuthPw, user);

    if (stretched === null) {
      await this.userRepository.update({ id: user.id }, { lastLoginFail: new Date() });

      throw new AccountRefusedError(this.incorrectPassword(user, email));
    }

    const keyFetchToken = await this.createKeyFetchToken(user, unwrapWrapKb(user.wrapWrapKb, stretched.wrapwrapKey));
    const passwordChangeToken = await this.createPasswordChangeToken(user);

    return { keyFetchToken, passwordChangeToken };
  }

  /**
   * Stores the new credentials with the same kA and wrapped kB, so keys and keysChangedAt stay as they were, ends every
   * session and signs the caller in again (fxa-auth-server/lib/routes/password.ts `/password/change/finish`).
   *
   * An account held to first-time setup is re-keyed instead: anyone with the documented password could fetch its kB
   * before setup, and that kB would decrypt everything the account later syncs.
   */
  async finishPasswordChange(
    authorization: string | undefined,
    newPassword: INewPassword,
    withKeys: boolean,
    userAgent: string | null
  ): Promise<ISignIn> {
    const user = await this.consumePasswordChangeToken(authorization);
    const callingSession = await this.sessionService.findByTokenId(newPassword.sessionTokenId);

    if (callingSession?.userId !== user.id) {
      throw new AccountRefusedError({ reason: 'invalid-session-token' });
    }

    const wrapKb = await this.replacePassword(
      user,
      {
        authPw: newPassword.authPw,
        clientSalt: newPassword.clientSalt,
        wrapKb: user.mustChangePassword ? null : newPassword.wrapKb,
      },
      null
    );

    return this.signIn(user, withKeys ? Buffer.from(wrapKb, 'hex') : null, userAgent);
  }

  /**
   * Sets a new password through an admin's reset link and re-keys the account, as Mozilla's `/account/reset` does
   * without a recovery key (fxa-auth-server/lib/routes/account.ts), then signs the caller in.
   */
  async resetPassword(reset: IPasswordReset, userAgent: string | null): Promise<ISignIn> {
    const { passwordReset } = await this.passwordResetService.check(reset.resetToken);

    if (passwordReset?.user === undefined) {
      throw new PasswordResetRefusedError({ reason: 'invalid-link' });
    }

    const user = passwordReset.user;

    if (!user.enabled) {
      throw new PasswordResetRefusedError({ reason: 'account-disabled' });
    }

    await this.replacePassword(
      user,
      { authPw: reset.authPw, clientSalt: reset.clientSalt, wrapKb: null },
      passwordReset
    );

    // The reset page words only a reset's own refusals; another change racing in after it means the link is spent.
    try {
      return await this.signIn(user, null, userAgent);
    } catch (error: unknown) {
      if (error instanceof AccountRefusedError) {
        throw new PasswordResetRefusedError({
          reason: error.refusal.reason === 'account-disabled' ? 'account-disabled' : 'invalid-link',
        });
      }

      throw error;
    }
  }

  async findClientSalt(email: string): Promise<string> {
    const user = await this.findByEmail(email);

    if (user === null) {
      throw new AccountRefusedError({ reason: 'unknown-account', email });
    }

    return user.clientSalt;
  }

  async existsByEmail(email: string): Promise<boolean> {
    return (await this.findByEmail(email)) !== null;
  }

  async existsByUid(uid: string): Promise<boolean> {
    return (await this.userRepository.count({ where: { uid } })) > 0;
  }

  /** The key bundle, returned once: the token is deleted whether or not it is still valid. */
  async fetchKeys(authorization: string | undefined): Promise<string> {
    const tokenId = readTokenId(authorization, 'keyFetchToken');

    const keyFetchToken =
      tokenId === null
        ? null
        : await this.keyFetchTokenRepository.findOne({ where: { tokenIdHash: hashToken(tokenId) } });

    if (keyFetchToken === null) {
      throw new AccountRefusedError({ reason: 'invalid-key-fetch-token' });
    }

    // Only the request whose delete removes the row may use it, so two racing fetches cannot both succeed.
    const { affected } = await this.keyFetchTokenRepository.delete({ id: keyFetchToken.id });

    if ((affected ?? 0) === 0) {
      throw new AccountRefusedError({ reason: 'invalid-key-fetch-token' });
    }

    if (Date.now() - keyFetchToken.createdAt > KEY_FETCH_TOKEN_LIFETIME_MS) {
      throw new AccountRefusedError({ reason: 'invalid-key-fetch-token' });
    }

    return keyFetchToken.bundle;
  }

  /** The token's account; the token is deleted whether or not it is still valid. */
  private async consumePasswordChangeToken(authorization: string | undefined): Promise<User> {
    const tokenId = readTokenId(authorization, 'passwordChangeToken');

    const passwordChangeToken =
      tokenId === null
        ? null
        : await this.passwordChangeTokenRepository.findOne({
            where: { tokenIdHash: hashToken(tokenId) },
            relations: { user: true },
          });

    if (passwordChangeToken?.user === undefined) {
      throw new AccountRefusedError({ reason: 'invalid-password-change-token' });
    }

    const { affected } = await this.passwordChangeTokenRepository.delete({ id: passwordChangeToken.id });

    if ((affected ?? 0) === 0) {
      throw new AccountRefusedError({ reason: 'invalid-password-change-token' });
    }

    if (Date.now() - passwordChangeToken.createdAt > PASSWORD_CHANGE_TOKEN_LIFETIME_MS) {
      throw new AccountRefusedError({ reason: 'invalid-password-change-token' });
    }

    if (!passwordChangeToken.user.enabled) {
      throw new AccountRefusedError({ reason: 'account-disabled' });
    }

    return passwordChangeToken.user;
  }

  /**
   * Stores the new credentials, raises verifierSetAt, ends every session and revokes every token of the account, as
   * Mozilla's resetAccount does, and returns the wrapKb stored. Without a client wrapKb it re-keys the account: a random
   * wrapKb under the new password is a random kB the server cannot derive, with a fresh kA and keysChangedAt, and the
   * account's Sync storage, encrypted under a kB nobody holds any more, is discarded.
   */
  private async replacePassword(
    user: User,
    credentials: INewCredentials,
    passwordReset: PasswordReset | null
  ): Promise<string> {
    const rekey = credentials.wrapKb === null;
    const wrapKb = credentials.wrapKb ?? randomHex(32);
    const verifierSetAt = Math.max(Date.now(), user.verifierSetAt + 1);

    // scrypt runs before the transaction, as at sign-up.
    const change: ICredentialChange = {
      ...(await createCredentials(credentials.authPw, wrapKb, credentials.clientSalt)),
      ...(rekey ? { kA: randomHex(32), keysChangedAt: verifierSetAt } : {}),
      verifierSetAt,
      mustChangePassword: false,
    };

    await this.replaceCredentials(user, change, rekey, passwordReset);

    Object.assign(user, change);

    return wrapKb;
  }

  /**
   * One transaction, the tokenserver write nesting in it as a savepoint: two resets racing on one link cannot both
   * succeed, a reset cannot land on an account disabled meanwhile, and a failed storage wipe leaves the old password.
   */
  @Transactional()
  private async replaceCredentials(
    user: User,
    change: ICredentialChange,
    rekey: boolean,
    passwordReset: PasswordReset | null
  ): Promise<void> {
    if (passwordReset !== null) {
      if (!(await this.passwordResetService.consume(passwordReset))) {
        throw new PasswordResetRefusedError({ reason: 'invalid-link' });
      }

      if (!(await this.userRepository.exists({ where: { id: user.id, enabled: true } }))) {
        throw new PasswordResetRefusedError({ reason: 'account-disabled' });
      }
    }

    await this.userRepository.update({ id: user.id }, change);

    await this.userService.invalidateSessions(user.id);
    await this.keyFetchTokenRepository.delete({ userId: user.id });
    await this.passwordChangeTokenRepository.delete({ userId: user.id });
    await this.passwordResetService.revoke(user.id);

    if (rekey) {
      await this.tokenserverService.recordKeyChange(user.uid, change.verifierSetAt);
    } else {
      await this.tokenserverService.recordPasswordChange(user.uid, change.verifierSetAt);
    }
  }

  /** fxa-auth-server/lib/routes/utils/signin.js checkPassword: the client retries with the stored case. */
  private incorrectPassword(user: User, email: string): AccountRefusal {
    return user.email === email
      ? { reason: 'incorrect-password' }
      : { reason: 'incorrect-email-case', storedEmail: user.email };
  }

  @Transactional()
  private async insertInvitedUser(user: User, invite: Invite): Promise<void> {
    if (!(await this.inviteService.consume(invite))) {
      throw new AccountRefusedError({ reason: 'invalid-invite' });
    }

    await this.userRepository.insert(user);
    await this.userService.updateRoles(invite.admin ? ADMIN_ROLES : [], user.id);
  }

  private async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { normalizedEmail: email.toLowerCase() } });
  }

  /**
   * Refuses an account whose password changed or that was disabled since `user` was read: scrypt runs between the
   * read and here, and a session created after the change ends every session would outlive it.
   */
  @Transactional()
  private async signIn(user: User, wrapKb: Buffer | null, userAgent: string | null): Promise<ISignIn> {
    if (!(await this.userRepository.exists({ where: { id: user.id, enabled: true } }))) {
      throw new AccountRefusedError({ reason: 'account-disabled' });
    }

    if (!(await this.userRepository.exists({ where: { id: user.id, verifierSetAt: user.verifierSetAt } }))) {
      throw new AccountRefusedError({ reason: 'incorrect-password' });
    }

    const { session, sessionToken } = await this.sessionService.createSession(user.id, userAgent);
    const keyFetchToken = wrapKb === null ? null : await this.createKeyFetchToken(user, wrapKb);

    return { user, session, sessionToken, keyFetchToken };
  }

  /** Replaces any earlier token of the account, as only the latest start can finish. */
  private async createPasswordChangeToken(user: User): Promise<string> {
    const now = Date.now();
    await this.passwordChangeTokenRepository.delete({ userId: user.id });
    await this.passwordChangeTokenRepository.delete({ createdAt: LessThan(now - PASSWORD_CHANGE_TOKEN_LIFETIME_MS) });

    const passwordChangeToken = randomHex(32);
    const { tokenId } = deriveTokenId(passwordChangeToken, 'passwordChangeToken');

    await this.passwordChangeTokenRepository.insert(
      new PasswordChangeToken({ tokenIdHash: hashToken(tokenId), userId: user.id, now })
    );

    return passwordChangeToken;
  }

  private async createKeyFetchToken(user: User, wrapKb: Buffer): Promise<string> {
    const now = Date.now();
    await this.keyFetchTokenRepository.delete({ createdAt: LessThan(now - KEY_FETCH_TOKEN_LIFETIME_MS) });

    const keyFetchToken = randomHex(32);
    const { tokenId, extraKey } = deriveTokenId(keyFetchToken, 'keyFetchToken');

    await this.keyFetchTokenRepository.insert(
      new KeyFetchToken({
        tokenIdHash: hashToken(tokenId),
        userId: user.id,
        bundle: bundleKeys(extraKey, Buffer.from(user.kA, 'hex'), wrapKb),
        now,
      })
    );

    return keyFetchToken;
  }
}
