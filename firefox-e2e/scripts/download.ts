import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { finished } from 'node:stream/promises';

import type { IDownload } from '../src/paths.ts';

export async function download(item: IDownload, target: string): Promise<void> {
  console.log(`Downloading ${item.url}`);

  const response = await fetch(item.url);

  if (!response.ok || response.body === null) {
    throw new Error(`Download failed: HTTP ${response.status} for ${item.url}`);
  }

  const partial = `${target}.partial`;
  const hash = createHash('sha256');

  mkdirSync(dirname(target), { recursive: true });

  const out = createWriteStream(partial);
  const reader = response.body.getReader();

  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    hash.update(chunk.value);

    if (!out.write(chunk.value)) {
      await once(out, 'drain');
    }
  }

  out.end();
  await finished(out);

  const actual = hash.digest('hex');

  if (actual !== item.sha256) {
    rmSync(partial);
    throw new Error(`Checksum mismatch for ${item.url}: expected ${item.sha256}, got ${actual}`);
  }

  renameSync(partial, target);
}
