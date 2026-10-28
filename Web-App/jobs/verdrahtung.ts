/**
 * Setzt die Ausführung für utils/nacharbeit.ts ein. Die Module werden erst beim
 * Aufruf geladen, damit die Verdrahtung beim Start nichts nachzieht. Der Pfad
 * führt über ../jobs/, damit require-Haken der Tests (/jobs[/\\]nachErfassung/)
 * ihn erkennen.
 */
import { verdrahteNacharbeit } from '../utils/nacharbeit';
import { meldeUndWeiter } from '../utils/httpError';

function verdrahte(): void {
  verdrahteNacharbeit({
    zieheNach: (sn, uid) => require('../jobs/nachErfassung').zieheNach(sn, uid),
    zieheNachNeuanlage: (sn, uid) => require('../jobs/nachErfassung').zieheNachNeuanlage(sn, uid),
    preisJobAnstossen: () => {
      require('../jobs/priceJob').triggerNow().catch((e: unknown) => meldeUndWeiter('einstellungen:preis-job-anstossen', e));
    },
    preisFuerSetHolen: (sn, uid, zustand) => require('../jobs/priceJob').refreshPriceForSet(sn, uid, zustand),
    bildVormerken: (url, sn) => require('../jobs/imageQueue').merkeGebraucht(url, sn),
  });
}

export { verdrahte };
