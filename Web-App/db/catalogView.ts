/** Catalog details as an account sees them (0093): the checked shared
 * value, otherwise the account's own detail. Entries of foreign accounts never
 * appear in the shared catalog and thus show up in no query. */

/** LEFT JOINs pc/pcc (shared) and te/tfe (own details of `konto`). */
export function teilSichtJoin(konto: string, nummer: string, color: string): string {
  return `LEFT JOIN part_catalog pc ON pc.part_number = ${nummer}
    LEFT JOIN part_color_catalog pcc ON pcc.part_number = ${nummer} AND pcc.color_id = ${color}
    LEFT JOIN part_custom te ON te.user_id = ${konto} AND te.part_number = ${nummer}
    LEFT JOIN part_color_custom tfe ON tfe.user_id = ${konto} AND tfe.part_number = ${nummer} AND tfe.color_id = ${color}`;
}

export const TEIL = {
  name: 'COALESCE(pc.part_name, te.part_name)',
  kategorie: 'COALESCE(pc.category_name, te.category_name)',
  farbname: 'COALESCE(pcc.color_name, tfe.color_name)',
  farbcode: 'COALESCE(pcc.color_hex, tfe.color_hex)',
  bild: 'COALESCE(pcc.image_url, tfe.image_url)',
  bildDatei: 'pcc.image_local',
} as const;

/** LEFT JOINs mc (shared) and fe (own details of `konto`). */
export function minifigViewJoin(konto: string, nummer: string): string {
  return `LEFT JOIN minifigs_catalog mc ON mc.fig_number = ${nummer}
    LEFT JOIN minifig_custom fe ON fe.user_id = ${konto} AND fe.fig_number = ${nummer}`;
}

export const MINIFIG = {
  name: 'COALESCE(mc.fig_name, fe.fig_name)',
  bild: 'COALESCE(mc.image_url, fe.image_url)',
  bildDatei: 'mc.image_local',
} as const;

/** LEFT JOINs rs/rt: name, year, theme and part count of a set live only in
 * rb_sets (0105); set_catalog adds image and minifig count. Year and part count 0
 * mean "unknown" in the Rebrickable CSV. */
export function setMasterJoin(nummer: string): string {
  return `LEFT JOIN rb_sets rs ON rs.set_num = ${nummer}
    LEFT JOIN rb_themes rt ON rt.id = rs.theme_id`;
}

export const SET = {
  name: 'rs.name',
  jahr: 'NULLIF(rs.year, 0)',
  thema: 'rt.name',
  teile: 'NULLIF(rs.num_parts, 0)',
} as const;
