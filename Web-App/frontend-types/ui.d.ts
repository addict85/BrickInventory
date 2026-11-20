// Types of the UI for type checking (tsconfig.frontend.json). They live
// outside of public/ so that they are not delivered.

// Fields the UI itself attaches to `window`.
interface Window {
  I18N_DE: Record<string, string>;
  I18N_EN: Record<string, string>;
  __APP_VERSION: string;
  __bimApplyTheme: (name: string) => void;
  __bimDunkel: ((wert: string) => void) | undefined;
  __bimDunkelWert: (() => 'server' | 'system' | 'immer') | undefined;
  __bimNurDunkel: (theme: string) => boolean;
  __bimLabelTables: ((tabelle: Element | null) => void) | undefined;
  pdfjsLib: PdfJs | undefined;
}

// Flags the UI attaches to elements: debounce timers and
// "already bound", so that a listener is not attached twice.
interface Element {
  _t?: ReturnType<typeof setTimeout>;
  _bound?: boolean;
  _tabBound?: boolean;
  _mobileScrollBound?: boolean;
  _fk?: number | null;
  _punkte?: { x: number; y: (number | null)[]; t: string[] }[];
}

// What G(id) delivers. The identifier determines whether an input, select or link
// stands behind it; the type covers the fields the UI reads from it.
type Feld = HTMLInputElement &
  Pick<HTMLSelectElement, 'options' | 'selectedIndex' | 'selectedOptions'> &
  Pick<HTMLAnchorElement, 'href' | 'download'>;

// Entries of the manual parts and figure lists: shared by parts.js, minifigs.js and purchase-dialogs.js.
// As global types, so that no file imports another because of them (no type cycle).
type ManuellesTeil = import('../frontend-types/contract').ManualPartsResponse['parts'][number];
type ManuelleFigur = import('../frontend-types/contract').ManualFigsResponse['figs'][number];

// The part of PDF.js the viewer (pdfviewer.js) uses. PDF.js
// comes as an ES module of its own from public/vendor (pdfjs-boot.js).
interface PdfAnsicht {
  width: number;
  height: number;
}
interface PdfSeite {
  getViewport(o: { scale: number }): PdfAnsicht;
  render(o: { canvasContext: CanvasRenderingContext2D | null; viewport: PdfAnsicht; background?: string }): {
    promise: Promise<void>;
    cancel(): void;
  };
  cleanup(): void;
}
interface PdfDokument {
  numPages: number;
  getPage(n: number): Promise<PdfSeite>;
  destroy(): void;
}
interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(quelle: object): { promise: Promise<PdfDokument>; destroy(): void };
}
declare module '/vendor/pdfjs/*' {
  export const GlobalWorkerOptions: PdfJs['GlobalWorkerOptions'];
  export const getDocument: PdfJs['getDocument'];
}

// qrcode.js from public/vendor, loaded as a classic script.
declare const QRCode: {
  new (ziel: HTMLElement, optionen: Record<string, unknown>): unknown;
  CorrectLevel: Record<'L' | 'M' | 'Q' | 'H', number>;
};
declare const __ERLAUBTE_STILE__: string[];

// A timer that never ran or has already been cleared stands as null;
// clearTimeout/clearInterval accept null in the browser without error.
declare function clearTimeout(id: ReturnType<typeof setTimeout> | null | undefined): void;
declare function clearInterval(id: ReturnType<typeof setInterval> | null | undefined): void;
