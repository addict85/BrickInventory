// Typen der Oberfläche für die Prüfung (tsconfig.frontend.json). Sie liegen
// ausserhalb von public/, damit sie nicht ausgeliefert werden.

// Felder, die die Oberfläche selbst an `window` hängt.
interface Window {
  I18N_DE: Record<string, string>;
  I18N_EN: Record<string, string>;
  __APP_VERSION: string;
  __bimApplyTheme: (name: string) => void;
  __bimDunkel: ((wert: string) => void) | undefined;
  __bimDunkelWert: (() => 'server' | 'system' | 'immer') | undefined;
  __bimNurDunkel: (theme: string) => boolean;
  __bimLabelTables: ((tabelle: Element | null) => void) | undefined;
  _finGrandTotal: number;
  _finPartsExtra: number;
  _imgObserver: IntersectionObserver | null;
  _partsScrollBound: boolean;
  _plServerUrl: string;
  pdfjsLib: PdfJs | undefined;
}

// Merker, die die Oberfläche an Elemente hängt: Entprell-Zeitgeber und
// „schon angebunden“, damit ein Lauscher nicht doppelt hängt.
interface Element {
  _t?: ReturnType<typeof setTimeout>;
  _bound?: boolean;
  _tabBound?: boolean;
  _mobileScrollBound?: boolean;
  _fk?: number | null;
  _punkte?: { x: number; y: (number | null)[]; t: string[] }[];
}

// Was G(id) liefert. Die Kennung bestimmt, ob Eingabe, Auswahl oder Verweis
// dahintersteht; der Typ deckt die Felder ab, die die Oberfläche daran liest.
type Feld = HTMLInputElement
  & Pick<HTMLSelectElement, 'options' | 'selectedIndex' | 'selectedOptions'>
  & Pick<HTMLAnchorElement, 'href' | 'download'>;

// Der Teil von PDF.js, den der Betrachter (12-pdfviewer.js) benutzt. PDF.js
// kommt als eigenes ES-Modul aus public/vendor (pdfjs-boot.js).
interface PdfAnsicht { width: number; height: number }
interface PdfSeite {
  getViewport(o: { scale: number }): PdfAnsicht;
  render(o: { canvasContext: CanvasRenderingContext2D | null; viewport: PdfAnsicht; background?: string }): { promise: Promise<void>; cancel(): void };
  cleanup(): void;
}
interface PdfDokument { numPages: number; getPage(n: number): Promise<PdfSeite>; destroy(): void }
interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(quelle: object): { promise: Promise<PdfDokument>; destroy(): void };
}
declare module '/vendor/pdfjs/*' {
  export const GlobalWorkerOptions: PdfJs['GlobalWorkerOptions'];
  export const getDocument: PdfJs['getDocument'];
}

// qrcode.js aus public/vendor, als klassisches Skript geladen.
declare const QRCode: {
  new (ziel: HTMLElement, optionen: Record<string, unknown>): unknown;
  CorrectLevel: Record<'L' | 'M' | 'Q' | 'H', number>;
};
declare const __ERLAUBTE_STILE__: string[];

// Ein Zeitgeber, der nie lief oder schon abgeräumt ist, steht als null da;
// clearTimeout/clearInterval nehmen null im Browser ohne Fehler hin.
declare function clearTimeout(id: ReturnType<typeof setTimeout> | null | undefined): void;
declare function clearInterval(id: ReturnType<typeof setInterval> | null | undefined): void;
