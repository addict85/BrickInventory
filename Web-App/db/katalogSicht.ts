/** Katalogangaben, wie ein Konto sie sieht (0093): der geprüfte gemeinsame
 * Wert, sonst die eigene Angabe des Kontos. Eingaben fremder Konten stehen
 * nie im gemeinsamen Katalog und tauchen so in keiner Abfrage auf. */

/** LEFT JOINs pc/pcc (gemeinsam) und te/tfe (eigene Angaben von `konto`). */
export function teilSichtJoin(konto: string, nummer: string, farbe: string): string {
  return `LEFT JOIN part_catalog pc ON pc.part_number = ${nummer}
    LEFT JOIN part_color_catalog pcc ON pcc.part_number = ${nummer} AND pcc.color_id = ${farbe}
    LEFT JOIN teil_eigen te ON te.user_id = ${konto} AND te.part_number = ${nummer}
    LEFT JOIN teil_farbe_eigen tfe ON tfe.user_id = ${konto} AND tfe.part_number = ${nummer} AND tfe.color_id = ${farbe}`;
}

export const TEIL = {
  name: 'COALESCE(pc.part_name, te.part_name)',
  kategorie: 'COALESCE(pc.category_name, te.category_name)',
  farbname: 'COALESCE(pcc.color_name, tfe.color_name)',
  farbcode: 'COALESCE(pcc.color_hex, tfe.color_hex)',
  bild: 'COALESCE(pcc.image_url, tfe.image_url)',
  bildDatei: 'pcc.image_local',
} as const;

/** LEFT JOINs mc (gemeinsam) und fe (eigene Angaben von `konto`). */
export function figurSichtJoin(konto: string, nummer: string): string {
  return `LEFT JOIN minifigs_catalog mc ON mc.fig_number = ${nummer}
    LEFT JOIN figur_eigen fe ON fe.user_id = ${konto} AND fe.fig_number = ${nummer}`;
}

export const FIGUR = {
  name: 'COALESCE(mc.fig_name, fe.fig_name)',
  bild: 'COALESCE(mc.image_url, fe.image_url)',
  bildDatei: 'mc.image_local',
} as const;

/** LEFT JOINs rs/rt: Name, Jahr, Thema und Teilezahl eines Sets stehen nur in
 * rb_sets (0105); set_catalog ergänzt Bild und Figurenzahl. Jahr und Teilezahl 0
 * heissen im Rebrickable-CSV „unbekannt“. */
export function setStammJoin(nummer: string): string {
  return `LEFT JOIN rb_sets rs ON rs.set_num = ${nummer}
    LEFT JOIN rb_themes rt ON rt.id = rs.theme_id`;
}

export const SET = {
  name: 'rs.name',
  jahr: 'NULLIF(rs.year, 0)',
  thema: 'rt.name',
  teile: 'NULLIF(rs.num_parts, 0)',
} as const;
