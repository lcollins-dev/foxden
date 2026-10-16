import { wholeNumberParam } from '../../fields';

// SQLite integers are 64-bit, but better-sqlite3 reads them as JavaScript numbers, which lose precision past this.
const MAX_ID = Number.MAX_SAFE_INTEGER;

export const IdParamDto = wholeNumberParam(0, MAX_ID);

export const PageParamDto = wholeNumberParam(1, MAX_ID);
