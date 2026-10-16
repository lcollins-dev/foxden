import { NestExpressApplication } from '@nestjs/platform-express';
import { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

import { RequestSurface, requestSurface } from './request-surface';

/** The surfaces whose responses carry tokens, keys or account details. */
const NO_STORE_SURFACES = new Set([RequestSurface.API, RequestSurface.ACCOUNTS, RequestSurface.TOKENSERVER]);

function noStore(request: Request, res: Response, next: NextFunction): void {
  if (NO_STORE_SURFACES.has(requestSurface(request.path))) {
    res.setHeader('Cache-Control', 'no-store');
  }

  next();
}

/**
 * helmet's defaults, less `upgrade-insecure-requests`: a server on a plain-HTTP address other than localhost is
 * supported, and the directive would send the web app's own scripts to an https:// origin that does not answer.
 */
export function useResponseHeaders(app: NestExpressApplication): void {
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }));
  app.use(noStore);
}
