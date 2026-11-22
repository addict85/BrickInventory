/** What the images read from the higher-level collection: an image is only needed by whoever holds, wishes for or
 * watches the set (db/inventoryView.ts). Without imports so that repositories may read it. */
type Konten = `= $${number}` | `= ANY($${number})`;

export interface ImagesReadContract {
  countedSets(konten?: Konten): string;
}
