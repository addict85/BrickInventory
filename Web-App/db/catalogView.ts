/** Catalog details as an account sees them (0093): the checked shared
 * value, otherwise the account's own detail. Entries of foreign accounts never
 * appear in the shared catalog and thus show up in no query. */

/** LEFT JOINs pc/pcc (shared) and te/tfe (own details of `account`). */
export function partViewJoin(account: string, number: string, color: string): string {
  return `LEFT JOIN part_catalog pc ON pc.part_number = ${number}
    LEFT JOIN part_color_catalog pcc ON pcc.part_number = ${number} AND pcc.color_id = ${color}
    LEFT JOIN part_custom te ON te.user_id = ${account} AND te.part_number = ${number}
    LEFT JOIN part_color_custom tfe ON tfe.user_id = ${account} AND tfe.part_number = ${number} AND tfe.color_id = ${color}`;
}

export const PART = {
  name: 'COALESCE(pc.part_name, te.part_name)',
  category: 'COALESCE(pc.category_name, te.category_name)',
  colorName: 'COALESCE(pcc.color_name, tfe.color_name)',
  colorHex: 'COALESCE(pcc.color_hex, tfe.color_hex)',
  image: 'COALESCE(pcc.image_url, tfe.image_url)',
  imageFile: 'pcc.image_local',
} as const;

/** LEFT JOINs mc (shared) and fe (own details of `account`). */
export function minifigViewJoin(account: string, number: string): string {
  return `LEFT JOIN minifigs_catalog mc ON mc.fig_number = ${number}
    LEFT JOIN minifig_custom fe ON fe.user_id = ${account} AND fe.fig_number = ${number}`;
}

export const MINIFIG = {
  name: 'COALESCE(mc.fig_name, fe.fig_name)',
  image: 'COALESCE(mc.image_url, fe.image_url)',
  imageFile: 'mc.image_local',
} as const;

/** LEFT JOINs rs/rt: name, year, theme and part count of a set live only in
 * rb_sets (0105); set_catalog adds image and minifig count. Year and part count 0
 * mean "unknown" in the Rebrickable CSV. */
export function setMasterJoin(number: string): string {
  return `LEFT JOIN rb_sets rs ON rs.set_num = ${number}
    LEFT JOIN rb_themes rt ON rt.id = rs.theme_id`;
}

export const SET = {
  name: 'rs.name',
  year: 'NULLIF(rs.year, 0)',
  theme: 'rt.name',
  parts: 'NULLIF(rs.num_parts, 0)',
} as const;
