/** Zeilen der Set-Repositories; im Dienst hinge das Repository über seine Typen am Dienst. */
export interface SetStamm {
  name: string | null;
  year: number | null;
  theme: string | null;
  pieces: number | null;
  minifigs?: number | null;
  image_url: string | null;
  image_local: string | null;
  /** Von setErfassen ohne Katalog angelegt: sagt nur, dass irgendein Konto die Nummer erfasst hat. */
  platzhalter?: boolean;
}
export interface ListenTeil {
  part_number: string;
  color_id: number;
  total_quantity: number | string;
  is_spare: unknown;
  bl_part_number?: string | null;
  part_name?: string | null;
  rb_image_url?: string | null;
  color_name?: string | null;
  color_hex?: string | null;
  bl_color_id?: number | null;
}
export interface KatalogTeil {
  part_number: string;
  color_id: number;
  bl_part_number: string | null;
  part_name: string | null;
  color_name: string | null;
  color_hex: string | null;
  image_url: string | null;
  image_local: string | null;
}
