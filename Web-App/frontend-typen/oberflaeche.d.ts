// Typen der Oberfläche für die Prüfung (tsconfig.frontend.json). Sie liegen
// ausserhalb von public/, damit sie nicht ausgeliefert werden.

// Felder, die die Oberfläche selbst an `window` hängt.
interface Window {
  I18N_DE: Record<string, string>;
  I18N_EN: Record<string, string>;
  __APP_VERSION: string;
  __bimApplyTheme: (name: string) => void;
  __bimDunkel: ((wert: string) => void) | undefined;
  __bimDunkelWert: (() => 'server' | 'system') | undefined;
  __bimNurDunkel: (theme: string) => boolean;
  __bimLabelTables: ((tabelle: Element | null) => void) | undefined;
  _finGrandTotal: unknown;
  _finPartsExtra: unknown;
  _imgObserver: IntersectionObserver | null;
  _partsScrollBound: boolean;
  _plServerUrl: string;
  pdfjsLib: any;
}

// Merker, die die Oberfläche an Elemente hängt: Entprell-Zeitgeber und
// „schon angebunden“, damit ein Lauscher nicht doppelt hängt.
interface Element {
  _t?: ReturnType<typeof setTimeout>;
  _bound?: boolean;
  _tabBound?: boolean;
  _mobileScrollBound?: boolean;
  _fk?: number | null;
}

// Was G(id) liefert. Die Kennung bestimmt, ob Eingabe, Auswahl oder Verweis
// dahintersteht; der Typ deckt die Felder ab, die die Oberfläche daran liest.
type Feld = HTMLInputElement
  & Pick<HTMLSelectElement, 'options' | 'selectedIndex' | 'selectedOptions'>
  & Pick<HTMLAnchorElement, 'href' | 'download'>;

// PDF.js kommt als eigenes ES-Modul aus public/vendor (pdfjs-boot.js).
declare module '/vendor/pdfjs/*' {
  export const GlobalWorkerOptions: { workerSrc: string };
  export function getDocument(quelle: unknown): any;
}

declare const QRCode: any;
declare const __ERLAUBTE_STILE__: string[];
