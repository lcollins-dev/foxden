import { type Locator, type Page } from '@playwright/test';

import { fieldError } from '../utils/fields';
import { webRoute } from '../utils/urls';

export class InvitesPage {
  constructor(private readonly page: Page) {}

  get heading(): Locator {
    return this.page.getByRole('heading', { name: 'Invites', exact: true });
  }

  get nameInput(): Locator {
    return this.page.locator('input[name="invite-name"]');
  }

  get nameError(): Locator {
    return fieldError(this.page, 'invite-name');
  }

  get emailInput(): Locator {
    return this.page.locator('input[name="invite-email"]');
  }

  get submitButton(): Locator {
    return this.page.getByRole('button', { name: 'Create Invite', exact: true });
  }

  get createError(): Locator {
    return fieldError(this.page, 'invite-email');
  }

  get inviteLink(): Locator {
    return this.page.getByTestId('invite-link');
  }

  get emailStatus(): Locator {
    return this.page.getByTestId('invite-email-status');
  }

  get doneButton(): Locator {
    return this.page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true });
  }

  pendingInvite(email: string): Locator {
    return this.page.getByTestId('pending-invite').filter({ hasText: email });
  }

  async goto(): Promise<void> {
    await this.page.goto(webRoute('/admin/invites'));
  }

  async createInvite(email: string, name = 'E2E Invitee'): Promise<void> {
    await this.nameInput.fill(name);
    await this.emailInput.fill(email);
    await this.submitButton.click();
  }
}
