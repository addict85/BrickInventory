/** Rows of the set repositories; in the service the repository would depend on the service via its types. */
export interface SetMaster {
  name: string | null;
  year: number | null;
  theme: string | null;
  pieces: number | null;
  minifigs?: number | null;
  image_url: string | null;
  image_local: string | null;
  /** Created by setErfassen without a catalog: only says that some account captured the number. */
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
export interface CatalogPart {
  part_number: string;
  color_id: number;
  bl_part_number: string | null;
  part_name: string | null;
  color_name: string | null;
  color_hex: string | null;
  image_url: string | null;
  image_local: string | null;
}
