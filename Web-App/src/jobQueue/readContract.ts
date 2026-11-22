/** What the jobs read from the higher-level account: a job runs with its account's role (db/accountView.ts). */
export interface JobsReadContract {
  ACCOUNTS: string;
}
