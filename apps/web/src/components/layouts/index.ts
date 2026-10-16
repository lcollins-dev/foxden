/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Component } from 'vue';

import Default from './Default.vue';
import Minimal from './Minimal.vue';

export enum Layout {
  DEFAULT = 'default',
  MINIMAL = 'minimal',
}

export const LAYOUT_COMPONENTS: { [key in Layout]: Component } = {
  [Layout.DEFAULT]: Default,
  [Layout.MINIMAL]: Minimal,
};
