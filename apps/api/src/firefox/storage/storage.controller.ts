import { Controller, Delete, Get, Param, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { z } from 'zod';

import { authenticatedUid, HawkAuthGuard } from './hawk-auth.guard';
import { FxaZodPipe } from '@/firefox/fxa/fxa-zod.pipe';

import { IStorageContext, StorageService } from '@/core/storage/storage.service';

import { parsePostBody, parsePutBody } from './bso-input';
import { storageErrors } from './storage-error';
import { bsoJson, postResultJson, timestampsJson } from './storage-json';
import { parseBsoListOptions, parseIds, queryParams } from './storage-query';
import { checkPostLimitHeaders, negotiateListFormat, parseBatchMode, parsePreconditions } from './storage-request';
import {
  IStorageResponse,
  NEWLINES_CONTENT_TYPE,
  preconditionResponse,
  sendStorageResponse,
  storageResponse,
} from './storage-response';
import { formatTimestamp } from './weave-timestamp';
import { BSO_ID_PATTERN, COLLECTION_PATTERN, STORAGE_LIMITS } from '@/core/storage/storage-limits';
import { PreconditionFailedError } from '@/core/storage/storage-refusal';
import { floorTimestamp } from '@/core/storage/storage-timestamp';

const BYTES_PER_KILOBYTE = 1024;

const requestBody = (request: Request): Buffer => {
  const body: unknown = request.body;

  return Buffer.isBuffer(body) ? body : Buffer.alloc(0);
};

function checkCollection(collection: string): string {
  if (!COLLECTION_PATTERN.test(collection)) {
    throw storageErrors.notFound();
  }

  return collection;
}

function checkBsoId(id: string): string {
  if (!BSO_ID_PATTERN.test(id)) {
    throw storageErrors.notFound();
  }

  return id;
}

/** The request start, which every response that writes nothing reports as its timestamp. */
const serverTime = (context: IStorageContext): number => floorTimestamp(context.now);

/** Sync storage 1.5 in syncstorage-rs's wire format (`syncserver/src/web/handlers.rs`). */
@UseGuards(HawkAuthGuard)
@Controller('storage/1.5/:uid')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  /** The limits Firefox sizes its uploads by; answered without checking preconditions. */
  @Get('info/configuration')
  async infoConfiguration(@Req() request: Request, @Res() res: Response): Promise<void> {
    const context = this.context(request);

    await this.send(res, context, async () => {
      await this.storageService.requireCurrentUid(context);

      return storageResponse(200, JSON.stringify(STORAGE_LIMITS), serverTime(context), { lastModified: 0 });
    });
  }

  @Get('info/collections')
  async infoCollections(@Req() request: Request, @Res() res: Response): Promise<void> {
    const context = this.context(request);

    await this.send(res, context, async () => {
      const { storageModified, value } = await this.storageService.collectionTimestamps(context);

      return storageResponse(200, timestampsJson(value), serverTime(context), {
        lastModified: storageModified,
        records: value.length,
      });
    });
  }

  @Get('info/collection_counts')
  async infoCollectionCounts(@Req() request: Request, @Res() res: Response): Promise<void> {
    const context = this.context(request);

    await this.send(res, context, async () => {
      const { storageModified, value } = await this.storageService.collectionCounts(context);

      return storageResponse(
        200,
        JSON.stringify(Object.fromEntries(value.map(entry => [entry.name, entry.count]))),
        serverTime(context),
        { lastModified: storageModified, records: value.length }
      );
    });
  }

  @Get('info/collection_usage')
  async infoCollectionUsage(@Req() request: Request, @Res() res: Response): Promise<void> {
    const context = this.context(request);

    await this.send(res, context, async () => {
      const { storageModified, value } = await this.storageService.collectionBytes(context);

      return storageResponse(
        200,
        JSON.stringify(Object.fromEntries(value.map(entry => [entry.name, entry.bytes / BYTES_PER_KILOBYTE]))),
        serverTime(context),
        { lastModified: storageModified, records: value.length }
      );
    });
  }

  /** Quotas are not enforced, so the limit is `null`. */
  @Get('info/quota')
  async infoQuota(@Req() request: Request, @Res() res: Response): Promise<void> {
    const context = this.context(request);

    await this.send(res, context, async () => {
      const { storageModified, value } = await this.storageService.collectionBytes(context);
      const total = value.reduce((sum, entry) => sum + entry.bytes, 0);

      return storageResponse(200, JSON.stringify([total / BYTES_PER_KILOBYTE, null]), serverTime(context), {
        lastModified: storageModified,
        records: null,
      });
    });
  }

  @Delete()
  async deleteUser(@Req() request: Request, @Res() res: Response): Promise<void> {
    await this.deleteStorage(request, res);
  }

  @Delete('storage')
  async deleteStorage(@Req() request: Request, @Res() res: Response): Promise<void> {
    const context = this.context(request);

    await this.send(res, context, async () => {
      const timestamp = await this.storageService.deleteStorage(context);

      return storageResponse(200, 'null', timestamp, { lastModified: timestamp });
    });
  }

  /** `X-Last-Modified` is the collection's timestamp, identical on every page so Firefox can pin it while paging. */
  @Get('storage/:collection')
  async getCollection(
    @Param('collection', new FxaZodPipe(z.string())) collection: string,
    @Req() request: Request,
    @Res() res: Response
  ): Promise<void> {
    const format = negotiateListFormat(request.headers.accept);
    const options = parseBsoListOptions(queryParams(request.originalUrl));
    const context = this.context(request);

    await this.send(res, context, async () => {
      const { collectionModified, page, nextOffset } = await this.storageService.listCollection(
        context,
        checkCollection(collection),
        options
      );

      const items = page.full ? page.bsos.map(bsoJson) : page.ids.map(id => JSON.stringify(id));
      const body = format === 'newlines' ? items.map(item => `${item}\n`).join('') : `[${items.join(',')}]`;

      return storageResponse(200, body, serverTime(context), {
        contentType: format === 'newlines' ? NEWLINES_CONTENT_TYPE : undefined,
        lastModified: collectionModified,
        records: items.length,
        nextOffset: nextOffset === null ? null : String(nextOffset),
      });
    });
  }

  @Post('storage/:collection')
  async postCollection(
    @Param('collection', new FxaZodPipe(z.string())) collection: string,
    @Req() request: Request,
    @Res() res: Response
  ): Promise<void> {
    checkCollection(collection);

    const context = this.context(request);
    const batch = parseBatchMode(queryParams(request.originalUrl));
    const items = parsePostBody(requestBody(request), request.headers['content-type'], collection);

    checkPostLimitHeaders(request.headers);

    await this.send(res, context, async () => {
      const outcome = await this.storageService.postBsos(context, collection, items.valid, batch);
      const success = items.valid.map(bso => bso.id);

      if (outcome.kind === 'batched') {
        return storageResponse(
          202,
          postResultJson({ batch: outcome.batchId, success, failed: items.failed }),
          serverTime(context),
          { lastModified: outcome.collectionModified }
        );
      }

      return storageResponse(
        200,
        postResultJson({ modified: outcome.modified, success, failed: items.failed }),
        outcome.modified,
        { lastModified: outcome.modified }
      );
    });
  }

  /** Without ids the collection goes entirely; with ids only those BSOs go, and the collection stays listed. */
  @Delete('storage/:collection')
  async deleteCollection(
    @Param('collection', new FxaZodPipe(z.string())) collection: string,
    @Req() request: Request,
    @Res() res: Response
  ): Promise<void> {
    const ids = queryParams(request.originalUrl).get('ids');
    const context = this.context(request);

    await this.send(res, context, async () => {
      const { modified, written } = await this.storageService.deleteCollection(
        context,
        checkCollection(collection),
        ids === null ? null : parseIds(ids)
      );

      return storageResponse(200, formatTimestamp(modified), written ? modified : serverTime(context), {
        lastModified: modified,
      });
    });
  }

  @Get('storage/:collection/:bso')
  async getBso(
    @Param('collection', new FxaZodPipe(z.string())) collection: string,
    @Param('bso', new FxaZodPipe(z.string())) bso: string,
    @Req() request: Request,
    @Res() res: Response
  ): Promise<void> {
    const context = this.context(request);

    await this.send(res, context, async () => {
      const stored = await this.storageService.getBso(context, checkCollection(collection), checkBsoId(bso));

      return storageResponse(200, bsoJson(stored), serverTime(context), { lastModified: stored.modified });
    });
  }

  /** Answers with the bare write timestamp, which Firefox keeps as the record's `modified`. */
  @Put('storage/:collection/:bso')
  async putBso(
    @Param('collection', new FxaZodPipe(z.string())) collection: string,
    @Param('bso', new FxaZodPipe(z.string())) bso: string,
    @Req() request: Request,
    @Res() res: Response
  ): Promise<void> {
    const context = this.context(request);
    const input = parsePutBody(
      requestBody(request),
      request.headers['content-type'],
      checkCollection(collection),
      checkBsoId(bso)
    );

    await this.send(res, context, async () => {
      const timestamp = await this.storageService.putBso(context, collection, input);

      return storageResponse(200, formatTimestamp(timestamp), timestamp, { lastModified: timestamp });
    });
  }

  @Delete('storage/:collection/:bso')
  async deleteBso(
    @Param('collection', new FxaZodPipe(z.string())) collection: string,
    @Param('bso', new FxaZodPipe(z.string())) bso: string,
    @Req() request: Request,
    @Res() res: Response
  ): Promise<void> {
    const context = this.context(request);

    await this.send(res, context, async () => {
      const timestamp = await this.storageService.deleteBso(context, checkCollection(collection), checkBsoId(bso));

      return storageResponse(200, `{"modified":${formatTimestamp(timestamp)}}`, timestamp, {
        lastModified: timestamp,
      });
    });
  }

  private context(request: Request): IStorageContext {
    return { uid: authenticatedUid(request), now: Date.now(), preconditions: parsePreconditions(request.headers) };
  }

  /** Answers a failed precondition with its 304 or 412; every other failure goes to the exception filter. */
  private async send(
    res: Response,
    context: IStorageContext,
    build: () => IStorageResponse | Promise<IStorageResponse>
  ): Promise<void> {
    let response: IStorageResponse;

    try {
      response = await build();
    } catch (error: unknown) {
      if (!(error instanceof PreconditionFailedError)) {
        throw error;
      }

      response = preconditionResponse(error, serverTime(context));
    }

    sendStorageResponse(res, response);
  }
}
