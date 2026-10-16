import { AccountStructure1790815949423 } from './1790815949423-AccountStructure';
import { InviteStructure1790815949444 } from './1790815949444-InviteStructure';
import { OAuthStructure1790815949455 } from './1790815949455-OAuthStructure';
import { TokenserverStructure1790815949466 } from './1790815949466-TokenserverStructure';
import { StorageStructure1790815949477 } from './1790815949477-StorageStructure';
import { SystemStructure1790815949488 } from './1790815949488-SystemStructure';
import { SessionOAuthTokens1790853933894 } from './1790853933894-SessionOAuthTokens';
import { PurgeExpiredSessionsJob1790888577682 } from './1790888577682-PurgeExpiredSessionsJob';
import { BatchJobRunHistory1790964761055 } from './1790964761055-BatchJobRunHistory';
import { BackupDatabaseJob1790965649705 } from './1790965649705-BackupDatabaseJob';
import { PasswordResetStructure1790968555553 } from './1790968555553-PasswordResetStructure';
import { TestAdmin9000000000001 } from './test/9000000000001-TestAdmin';

export const migrations = [
  AccountStructure1790815949423,
  InviteStructure1790815949444,
  OAuthStructure1790815949455,
  TokenserverStructure1790815949466,
  StorageStructure1790815949477,
  SystemStructure1790815949488,
  SessionOAuthTokens1790853933894,
  PurgeExpiredSessionsJob1790888577682,
  BatchJobRunHistory1790964761055,
  BackupDatabaseJob1790965649705,
  PasswordResetStructure1790968555553,
];
export const testMigrations = [TestAdmin9000000000001];
