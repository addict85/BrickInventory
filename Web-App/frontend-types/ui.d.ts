// Types of the UI for type checking (tsconfig.frontend.json). They live
// outside of public/ so that they are not delivered.

// Fields the UI itself attaches to `window`.
interface Window {
  I18N_DE: Record<string, string>;
  I18N_EN: Record<string, string>;
  __APP_VERSION: string;
  __bimApplyTheme: (name: string) => void;
  __bimDark: ((value: string) => void) | undefined;
  __bimDarkValue: (() => 'server' | 'system' | 'always') | undefined;
  __bimOnlyDark: (theme: string) => boolean;
  __bimLabelTables: ((table: Element | null) => void) | undefined;
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
  _dots?: { x: number; y: (number | null)[]; t: string[] }[];
}

// What G(id) delivers. The identifier determines whether an input, select or link
// stands behind it; the type covers the fields the UI reads from it.
type Field = HTMLInputElement &
  Pick<HTMLSelectElement, 'options' | 'selectedIndex' | 'selectedOptions'> &
  Pick<HTMLAnchorElement, 'href' | 'download'>;

// Entries of the manual parts and figure lists: shared by parts.js, minifigs.js and purchase-dialogs.js.
// As global types, so that no file imports another because of them (no type cycle).
type ManualPart = import('../frontend-types/contract').ManualPartsResponse['parts'][number];
type ManualMinifig = import('../frontend-types/contract').ManualFigsResponse['figs'][number];

// The part of PDF.js the viewer (pdfviewer.js) uses. PDF.js
// comes as an ES module of its own from public/vendor (pdfjs-boot.js).
interface PdfView {
  width: number;
  height: number;
}
interface PdfPage {
  getViewport(o: { scale: number }): PdfView;
  render(o: { canvasContext: CanvasRenderingContext2D | null; viewport: PdfView; background?: string }): {
    promise: Promise<void>;
    cancel(): void;
  };
  cleanup(): void;
}
interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy(): void;
}
interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(source: object): { promise: Promise<PdfDocument>; destroy(): void };
}
declare module '/vendor/pdfjs/*' {
  export const GlobalWorkerOptions: PdfJs['GlobalWorkerOptions'];
  export const getDocument: PdfJs['getDocument'];
}

// qrcode.js from public/vendor, loaded as a classic script.
declare const QRCode: {
  new (target: HTMLElement, options: Record<string, unknown>): unknown;
  CorrectLevel: Record<'L' | 'M' | 'Q' | 'H', number>;
};
declare const __ALLOWED_STYLES__: string[];

// A timer that never ran or has already been cleared stands as null;
// clearTimeout/clearInterval accept null in the browser without error.
declare function clearTimeout(id: ReturnType<typeof setTimeout> | null | undefined): void;
declare function clearInterval(id: ReturnType<typeof setInterval> | null | undefined): void;
