import { describe, expect, it } from 'vitest';

import { StorageError } from './storage-error';
import { checkPostLimitHeaders, negotiateListFormat, parseBatchMode, parsePreconditions } from './storage-request';
import { preconditionResponse } from './storage-response';
import { PreconditionFailedError } from '@/core/storage/storage-refusal';

const errorOf = (work: () => unknown): string | null => {
  try {
    work();
  } catch (error) {
    if (error instanceof StorageError) {
      return `${error.httpStatus} ${error.weaveCode}`;
    }
  }

  return null;
};

describe('storage-request', () => {
  describe('preconditions', () => {
    it('parses either header, including zero', () => {
      expect(parsePreconditions({ 'x-if-unmodified-since': '0' })).toEqual({
        ifModifiedSince: null,
        ifUnmodifiedSince: 0,
      });
      expect(parsePreconditions({ 'x-if-modified-since': '1700000000.12' }).ifModifiedSince).toBe(1700000000120);
    });

    it('rejects both headers together, or a bad value', () => {
      expect(errorOf(() => parsePreconditions({ 'x-if-modified-since': '1', 'x-if-unmodified-since': '1' }))).toBe(
        '400 0'
      );
      expect(errorOf(() => parsePreconditions({ 'x-if-unmodified-since': '-3' }))).toBe('400 0');
    });

    it('answers a failed X-If-Unmodified-Since with 412 and X-If-Modified-Since with 304, both bodiless', () => {
      expect(preconditionResponse(new PreconditionFailedError('if-unmodified-since', 110), 200)).toMatchObject({
        status: 412,
        body: null,
        serverTime: 200,
        lastModified: 110,
      });
      expect(preconditionResponse(new PreconditionFailedError('if-modified-since', 110), 200)).toMatchObject({
        status: 304,
        body: null,
        lastModified: 110,
      });
    });
  });

  describe('parseBatchMode', () => {
    const mode = (query: string) => parseBatchMode(new URLSearchParams(query));

    it('reads the batch parameters Firefox sends', () => {
      expect(mode('')).toEqual({ kind: 'none' });
      expect(mode('batch=true')).toEqual({ kind: 'create', commit: false });
      expect(mode('batch=')).toEqual({ kind: 'create', commit: false });
      expect(mode('batch=TRUE&commit=true')).toEqual({ kind: 'create', commit: true });
      expect(mode('batch=abc')).toEqual({ kind: 'append', batchId: 'abc', commit: false });
      expect(mode('batch=a%2Bb%3D&commit=True')).toEqual({ kind: 'append', batchId: 'a+b=', commit: true });
    });

    it('rejects a commit without a batch or with a value other than true', () => {
      expect(errorOf(() => mode('commit=true'))).toBe('400 0');
      expect(errorOf(() => mode('batch=true&commit=yes'))).toBe('400 0');
    });
  });

  describe('checkPostLimitHeaders', () => {
    it('accepts announcements within the limits', () => {
      expect(errorOf(() => checkPostLimitHeaders({ 'x-weave-records': '100', 'x-weave-total-bytes': '1' }))).toBeNull();
    });

    it('answers a non-integer with 0 and an excess with 17', () => {
      expect(errorOf(() => checkPostLimitHeaders({ 'x-weave-bytes': 'lots' }))).toBe('400 0');
      expect(errorOf(() => checkPostLimitHeaders({ 'x-weave-records': '101' }))).toBe('400 17');
      expect(errorOf(() => checkPostLimitHeaders({ 'x-weave-total-bytes': '262144001' }))).toBe('400 17');
    });
  });

  describe('negotiateListFormat', () => {
    it.each([
      [undefined, 'json'],
      ['application/json;q=0.9,*/*;q=0.2', 'json'],
      ['*/*', 'json'],
      ['application/newlines', 'newlines'],
      ['application/json;q=0.5, application/newlines', 'newlines'],
    ])('picks %s as %s', (accept, format) => {
      expect(negotiateListFormat(accept)).toBe(format);
    });

    it.each(['text/plain', 'x/yy', 'application/json;q=0'])('refuses %s with 406', accept => {
      expect(errorOf(() => negotiateListFormat(accept))).toBe('406 0');
    });
  });
});
