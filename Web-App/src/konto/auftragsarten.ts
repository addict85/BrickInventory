/** Dateien eines gelöschten Kontos, die beim Löschen liegen blieben: Der Auftrag versucht es wieder. */
import { z } from 'zod';
import { auftragsart, type Anmeldung } from '../auftraege';
import { loescheKontoDateien } from './kontoEntfernen';

const KontoDateien = z.object({ user_id: z.number().int().positive() });

declare module '../auftraege/auftraege' {
  interface AuftragsNutzlasten {
    konto_dateien: typeof KontoDateien;
  }
}

export function kontoAuftragsarten(): Anmeldung[] {
  return [
    auftragsart({ art: 'konto_dateien', nutzlast: KontoDateien, ausfuehren: n => loescheKontoDateien(n.user_id) }),
  ];
}
