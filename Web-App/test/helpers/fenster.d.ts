// Felder, die die Oberfläche selbst an `window` hängt — für die Typprüfung
// (test/browser-namen.test.js); sie liegt hier, damit sie nicht ausgeliefert wird.
interface Window {
  I18N_DE: Record<string, string>;
  I18N_EN: Record<string, string>;
  __APP_VERSION: string;
  __bimApplyTheme: (name: string) => void;
  __bimDunkel: unknown;
  __bimDunkelWert: string;
  __bimLabelTables: unknown;
  _finGrandTotal: unknown;
  _finPartsExtra: unknown;
  _imgObserver: IntersectionObserver | null;
  _partsScrollBound: boolean;
  _plServerUrl: string;
  pdfjsLib: any;
}
declare const QRCode: any;
declare const __ERLAUBTE_STILE__: string[];
