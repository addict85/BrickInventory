/**
 * Setzt die Ausführung für utils/nacharbeit.ts ein. Die Module werden erst beim
 * Aufruf geladen, damit die Verdrahtung beim Start nichts nachzieht. Der Pfad
 * führt über ../jobs/, damit require-Haken der Tests (/jobs[/\\]nachErfassung/)
 * ihn erkennen.
 */
import { verdrahteNacharbeit } from '../utils/nacharbeit';
import { verdrahteJobsteuerung } from '../utils/jobsteuerung';
import { meldeUndWeiter } from '../utils/httpError';

function verdrahte(): void {
  verdrahteNacharbeit({
    preisJobAnstossen: () => {
      require('../jobs/priceJob').triggerNow().catch((e: unknown) => meldeUndWeiter('einstellungen:preis-job-anstossen', e));
    },
    preisFuerSetHolen: (sn, uid, zustand) => require('../jobs/priceJob').refreshPriceForSet(sn, uid, zustand),
    bildVormerken: (url, sn) => require('../jobs/imageQueue').merkeGebraucht(url, sn),
    setTeileAnreichern: (sn) => require('../jobs/partsCatalogEnrich').enrichSetParts(sn),
    figurenAnreichern: (sn) => require('../jobs/partsCatalogEnrich').enrichSetMinifigs(sn),
    setBilderLaden: (sn) => require('../jobs/partsCatalogEnrich').downloadSetImages(sn),
  });
  verdrahteJobsteuerung({
    anleitungEinreihen: (sn) => require('../jobs/instructionQueue').enqueue(sn),
    anleitungenOffen: () => require('../jobs/instructionQueue').offeneAuftraege(),
    anleitungenLaufAnfordern: () => require('../jobs/instructionQueue').requestRun(),
    preisJobStatus: () => require('../jobs/priceJob').getJobStatus(),
    preisJobJetzt: () => require('../jobs/priceJob').triggerNow(),
    bilderJeMinute: () => require('../jobs/imageQueue').anfragenJeMinute(),
    fehlendeBilderNachladen: () => require('../jobs/partsCatalogEnrich').redownloadMissingImages(),
    bricksetWarteschlange: (sofort) => require('../jobs/bricksetRetry').processRetryQueue(sofort),
    zeitplanNeu: () => require('../jobs/dailyScheduler').rescheduleAll(),
  });
}

export { verdrahte };
