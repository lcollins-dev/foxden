import type { Component } from 'vue';
import IconComputer from '~icons/material-symbols/computer-outline-rounded';
import IconDesktopWindows from '~icons/material-symbols/desktop-windows-outline-rounded';
import IconLanguage from '~icons/material-symbols/language-rounded';
import IconLaptopMac from '~icons/material-symbols/laptop-mac-outline-rounded';
import IconSmartphone from '~icons/material-symbols/mobile-outline-rounded';
import IconTablet from '~icons/material-symbols/tablet-outline-rounded';
import IconTv from '~icons/material-symbols/tv-outline-rounded';
import IconViewInAr from '~icons/material-symbols/view-in-ar-outline-rounded';

import type { AccountSessionDto } from '@libs/dto';

import { formatDay, formatRelativeDate } from './date';
import { describeUserAgent } from './describeUserAgent';

export interface ISessionRow {
  id: number;
  /** A session with a registered device is a Firefox signed in to Sync; one without is a web app sign-in. */
  firefox: boolean;
  name: string;
  icon: Component;
  meta: string;
  current: boolean;
}

const ACTIVE_NOW_MS = 5 * 60 * 1000;

const DEVICE_TYPE_ICONS: Record<string, Component> = {
  mobile: IconSmartphone,
  tablet: IconTablet,
  tv: IconTv,
  vr: IconViewInAr,
};

const desktopIcon = (os: string | null): Component => {
  switch (os) {
    case 'macOS':
      return IconLaptopMac;
    case 'Windows':
      return IconDesktopWindows;
    default:
      return IconComputer;
  }
};

const lastActive = (session: AccountSessionDto, now: Date): string => {
  const lastAccess = new Date(session.lastAccessAt);

  return now.getTime() - lastAccess.getTime() < ACTIVE_NOW_MS
    ? 'Active now'
    : `Active ${formatRelativeDate(lastAccess)}`;
};

export const toSessionRow = (session: AccountSessionDto, now: Date = new Date()): ISessionRow => {
  const { browser, os } = describeUserAgent(session.userAgent);
  const signedIn = `Signed in ${formatDay(new Date(session.createdAt), now)}`;

  if (session.device !== null) {
    const client = os === null ? browser : `${browser} on ${os}`;

    return {
      id: session.id,
      firefox: true,
      name: session.device.name !== '' ? session.device.name : client,
      icon: DEVICE_TYPE_ICONS[session.device.type] ?? desktopIcon(os),
      meta: [client, lastActive(session, now), signedIn].join(' · '),
      current: session.current,
    };
  }

  const browserName = browser.replace(/ \d+$/, '');

  return {
    id: session.id,
    firefox: false,
    name: os === null ? browserName : `${browserName} on ${os}`,
    icon: IconLanguage,
    meta: [lastActive(session, now), signedIn].join(' · '),
    current: session.current,
  };
};
