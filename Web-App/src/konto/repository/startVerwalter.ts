import type { DbSchnittstelle } from '../../../db/database';

export async function kontenVorhanden(db: DbSchnittstelle): Promise<boolean> {
  return !!(await db.get<unknown>('SELECT 1 FROM users LIMIT 1'));
}

export async function startpasswortOffen(db: DbSchnittstelle): Promise<boolean> {
  return !!(await db.get<unknown>('SELECT 1 FROM users WHERE is_admin AND must_change_password LIMIT 1'));
}

export async function legeVerwalterAn(db: DbSchnittstelle, hash: string, startpasswort: boolean): Promise<void> {
  await db.run(
    `INSERT INTO users (username, password_hash, is_admin, is_active, email_verified, must_change_password)
     VALUES ('admin', $1, true, true, true, $2)`,
    [hash, startpasswort],
  );
}
