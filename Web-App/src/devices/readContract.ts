/** What the devices read from the higher-level accesses: a key applies as long as its token family lives
 * (db/accessView.ts). */
export interface DevicesReadContract {
  familyAlive(account: string, since: string): string;
  tokenFamilySql(hash: string): string;
}
