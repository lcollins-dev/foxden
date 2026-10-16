import { formatTimestamp } from './weave-timestamp';
import { IStoredBso } from '@/core/storage/bso';

/**
 * JSON with sync timestamps as numbers with exactly two decimals, which Mozilla's conformance suite checks and
 * `JSON.stringify` does not produce (`1700000000.1` would lose its trailing zero).
 */

/** Key order `id`, `modified`, `payload`, `sortindex` as syncstorage-rs; `sortindex` left out when unset. */
export function bsoJson(bso: IStoredBso): string {
  const sortindex = bso.sortindex === null ? '' : `,"sortindex":${bso.sortindex}`;

  return `{"id":${JSON.stringify(bso.id)},"modified":${formatTimestamp(bso.modified)},"payload":${JSON.stringify(bso.payload)}${sortindex}}`;
}

export function timestampsJson(timestamps: { name: string; modified: number }[]): string {
  const entries = timestamps.map(entry => `${JSON.stringify(entry.name)}:${formatTimestamp(entry.modified)}`);

  return `{${entries.join(',')}}`;
}

export interface IPostResult {
  modified?: number;
  batch?: string;
  success: string[];
  failed: Record<string, string>;
}

export function postResultJson(result: IPostResult): string {
  const fields: string[] = [];

  if (result.modified !== undefined) {
    fields.push(`"modified":${formatTimestamp(result.modified)}`);
  }

  if (result.batch !== undefined) {
    fields.push(`"batch":${JSON.stringify(result.batch)}`);
  }

  fields.push(`"success":${JSON.stringify(result.success)}`);
  fields.push(`"failed":${JSON.stringify(result.failed)}`);

  return `{${fields.join(',')}}`;
}
