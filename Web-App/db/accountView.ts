/** Accounts as areas under `konto` read them: users belongs to the account. Only name and role
 * travel downwards; password and keys stay with the owner. */

/** Subquery with the columns id, username, is_admin. */
export const ACCOUNTS = '(SELECT id, username, is_admin FROM users)';
