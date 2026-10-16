import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const git = (...args: string[]): string => execFileSync('git', args, { encoding: 'utf-8' }).trim();

// Mirrors resources/instanced/instance.sh without claiming a number: the main worktree is instance 1, and a linked
// worktree's number is the one its first `instance:start` recorded in `.workdir/instance`.
const resolveLocalInstance = (): number | null => {
  try {
    const gitDir = git('rev-parse', '--path-format=absolute', '--git-dir');
    const gitCommonDir = git('rev-parse', '--path-format=absolute', '--git-common-dir');

    if (gitDir === gitCommonDir) {
      return 1;
    }

    const recorded = readFileSync(join(git('rev-parse', '--show-toplevel'), '.workdir', 'instance'), 'utf-8').trim();

    return /^[1-9][0-9]*$/.test(recorded) ? Number(recorded) : null;
  } catch {
    return null;
  }
};

const LOCAL_INSTANCE = resolveLocalInstance();

const resolveLocalOrigin = (): string =>
  LOCAL_INSTANCE === null ? 'http://localhost:8080' : `http://localhost:${8080 + LOCAL_INSTANCE * 100}`;

const ORIGIN = process.env.E2E_BASE_URL ?? resolveLocalOrigin();

const stripTrailingSlash = (value: string): string => value.replace(/\/$/, '');

export const BASE_URL = stripTrailingSlash(ORIGIN);

export const webRoute = (path: string): string => `${BASE_URL}${path}`;
