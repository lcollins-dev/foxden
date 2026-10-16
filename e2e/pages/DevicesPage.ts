import { type Locator, type Page } from '@playwright/test';

import { webRoute } from '../utils/urls';

export class DevicesPage {
  constructor(private readonly page: Page) {}

  get firefoxRows(): Locator {
    return this.page.getByTestId('firefox-devices').getByTestId('device-row');
  }

  get webRows(): Locator {
    return this.page.getByTestId('web-sessions').getByTestId('session-row');
  }

  get signOutOthersButton(): Locator {
    return this.page.getByRole('button', { name: 'Sign Out All Others', exact: true });
  }

  signOutButton(row: Locator): Locator {
    return row.getByRole('button', { name: 'Sign out', exact: true });
  }

  async goto(): Promise<void> {
    await this.page.goto(webRoute('/devices'));
  }
}
