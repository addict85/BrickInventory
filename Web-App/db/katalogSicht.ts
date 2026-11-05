/**
 * Katalogangaben, wie ein Konto sie sieht (Migration 0093): der geprüfte Wert
 * aus dem gemeinsamen Katalog, sonst die eigene Angabe des Kontos, dem die
 * Bestandszeile gehört. Eingaben fremder Konten stehen nirgends im
 * gemeinsamen Katalog und können so in keiner Abfrage auftauchen.
 */

/** LEFT JOINs pc/pcc (gemeinsam) und te/tfe (eigene Angaben von `konto`). */
export function teilSichtJoin(konto: string, nummer: string, farbe: string): string {
  return `LEFT JOIN part_catalog pc ON pc.part_number = ${nummer}
    LEFT JOIN part_color_catalog pcc ON pcc.part_number = ${nummer} AND pcc.color_id = ${farbe}
    LEFT JOIN teil_eigen te ON te.user_id = ${konto} AND te.part_number = ${nummer}
    LEFT JOIN teil_farbe_eigen tfe ON tfe.user_id = ${konto} AND tfe.part_number = ${nummer} AND tfe.color_id = ${farbe}`;
}

export const TEIL = {
  name:      'COALESCE(pc.part_name, te.part_name)',
  kategorie: 'COALESCE(pc.category_name, te.category_name)',
  farbname:  'COALESCE(pcc.color_name, tfe.color_name)',
  farbcode:  'COALESCE(pcc.color_hex, tfe.color_hex)',
  bild:      'COALESCE(pcc.image_url, tfe.image_url)',
  bildDatei: 'pcc.image_local',
} as const;

/** LEFT JOINs mc (gemeinsam) und fe (eigene Angaben von `konto`). */
export function figurSichtJoin(konto: string, nummer: string): string {
  return `LEFT JOIN minifigs_catalog mc ON mc.fig_number = ${nummer}
    LEFT JOIN figur_eigen fe ON fe.user_id = ${konto} AND fe.fig_number = ${nummer}`;
}

export const FIGUR = {
  name:      'COALESCE(mc.fig_name, fe.fig_name)',
  bild:      'COALESCE(mc.image_url, fe.image_url)',
  bildDatei: 'mc.image_local',
} as const;
