/** Rows of the minifig repositories; same reasoning as src/sets/zeilen.ts. */
export interface MinifigPart {
  part_number: string;
  bl_part_number: string;
  part_name: string | null;
  color_id: number;
  color_name: string | null;
  color_hex: string | null;
  is_spare: boolean;
  quantity: number;
}
export interface CatalogRow {
  part_number: string;
  color_id: number;
  bl_part_number: string | null;
  image_url: string | null;
  image_local: string | null;
}
