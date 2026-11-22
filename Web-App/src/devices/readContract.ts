/** What the devices read from the higher-level accesses: a key applies as long as its token family lives
 * (db/accessView.ts). */
export interface DevicesReadContract {
  familieLebt(konto: string, seit: string): string;
  tokenFamilySql(hash: string): string;
}
