/** A write of one BSO. A `null` field was not provided, so an update keeps the stored value. */
export interface IBsoInput {
  id: string;
  sortindex: number | null;
  payload: string | null;
  ttl: number | null;
}

export interface IStoredBso {
  id: string;
  modified: number;
  payload: string;
  sortindex: number | null;
}
