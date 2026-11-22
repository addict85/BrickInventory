import type { DbInterface, Treffer } from '../../../db/database';

export interface InstructionRow {
  id: number;
  set_number: string;
  url: string;
  description: string | null;
  local_path: string | null;
  fetched_at: Date | null;
}

export function countInstructions(db: DbInterface, setNumber: string) {
  return db.get<{ c: string }>('SELECT COUNT(*) as c FROM shared_instructions WHERE set_number = $1', [setNumber]);
}

export function instructionsOfSets(db: DbInterface, setNumber: string) {
  return db.all<InstructionRow>('SELECT * FROM shared_instructions WHERE set_number = $1', [setNumber]);
}

export function deleteInstructionsOfSets(db: DbInterface, setNumber: string) {
  return db.run('DELETE FROM shared_instructions WHERE set_number = $1', [setNumber]);
}

export function hatBrickinstructions(db: DbInterface, setNumber: string) {
  return db.get<Treffer>("SELECT 1 FROM shared_instructions WHERE set_number = $1 AND url LIKE '%brickinstructions%'", [
    setNumber,
  ]);
}

export function storeInstruction(
  db: DbInterface,
  setNumber: string,
  url: string,
  description: string | null,
  localPath: string | null,
) {
  return db.run(
    'INSERT INTO shared_instructions (set_number,url,description,local_path) VALUES ($1,$2,$3,$4) ON CONFLICT (set_number,url) DO NOTHING',
    [setNumber, url, description, localPath],
  );
}

export function setInstructionFile(db: DbInterface, localPath: string, setNumber: string) {
  return db.run('UPDATE shared_instructions SET local_path = $1 WHERE set_number = $2 AND local_path IS NULL', [
    localPath,
    setNumber,
  ]);
}
