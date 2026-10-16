import { AccountSettingsPage } from '../pages/AccountSettingsPage';
import { AdminBatchJobPage } from '../pages/AdminBatchJobPage';
import { AdminBatchJobsPage } from '../pages/AdminBatchJobsPage';
import { AdminUserPage } from '../pages/AdminUserPage';
import { AdminUsersPage } from '../pages/AdminUsersPage';
import { ConnectFirefoxPage } from '../pages/ConnectFirefoxPage';
import { DevicesPage } from '../pages/DevicesPage';
import { FirstTimeSetupPage } from '../pages/FirstTimeSetupPage';
import { HeaderMenu } from '../pages/HeaderMenu';
import { InvitePage } from '../pages/InvitePage';
import { InvitesPage } from '../pages/InvitesPage';
import { ResetPasswordPage } from '../pages/ResetPasswordPage';
import { SignInPage } from '../pages/SignInPage';
import { test as base } from './error-guards';

interface IPageFixtures {
  signInPage: SignInPage;
  connectFirefoxPage: ConnectFirefoxPage;
  devicesPage: DevicesPage;
  accountSettingsPage: AccountSettingsPage;
  firstTimeSetupPage: FirstTimeSetupPage;
  headerMenu: HeaderMenu;
  adminUsersPage: AdminUsersPage;
  invitesPage: InvitesPage;
  adminUserPage: AdminUserPage;
  adminBatchJobsPage: AdminBatchJobsPage;
  adminBatchJobPage: AdminBatchJobPage;
  invitePage: InvitePage;
  resetPasswordPage: ResetPasswordPage;
}

export const test = base.extend<IPageFixtures>({
  signInPage: async ({ page }, use) => {
    await use(new SignInPage(page));
  },
  connectFirefoxPage: async ({ page }, use) => {
    await use(new ConnectFirefoxPage(page));
  },
  devicesPage: async ({ page }, use) => {
    await use(new DevicesPage(page));
  },
  accountSettingsPage: async ({ page }, use) => {
    await use(new AccountSettingsPage(page));
  },
  firstTimeSetupPage: async ({ page }, use) => {
    await use(new FirstTimeSetupPage(page));
  },
  headerMenu: async ({ page }, use) => {
    await use(new HeaderMenu(page));
  },
  adminUsersPage: async ({ page }, use) => {
    await use(new AdminUsersPage(page));
  },
  invitesPage: async ({ page }, use) => {
    await use(new InvitesPage(page));
  },
  adminUserPage: async ({ page }, use) => {
    await use(new AdminUserPage(page));
  },
  adminBatchJobsPage: async ({ page }, use) => {
    await use(new AdminBatchJobsPage(page));
  },
  adminBatchJobPage: async ({ page }, use) => {
    await use(new AdminBatchJobPage(page));
  },
  invitePage: async ({ page }, use) => {
    await use(new InvitePage(page));
  },
  resetPasswordPage: async ({ page }, use) => {
    await use(new ResetPasswordPage(page));
  },
});

export { expect } from '@playwright/test';
