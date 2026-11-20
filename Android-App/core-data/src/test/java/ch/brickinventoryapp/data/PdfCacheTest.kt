package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.util.PdfStep
import ch.brickinventoryapp.data.util.pdfStep
import org.junit.Test

/**
 * Eine fertig geladene Anleitung wird nicht „fortgesetzt": Nach einem vollständigen
 * Download zeigte `Range: bytes=<Grösse>-` hinter das letzte Byte, und der Server
 * antwortet zu Recht mit 416 (über die Anleitungs-Route als 404). Die Entscheidung
 * „fertig oder ab welchem Byte" ist darum eine reine Funktion und hier ausgeführt;
 * die Serverhälfte prüft Web-App/test/instruction-area.test.js.
 *
 * Gegenprobe: in pdfStep() den ersten Zweig entfernt, so dass eine fertige Datei
 * wieder als Fortsetzpunkt gilt → der erste Schritt unten wird rot.
 */
class PdfCacheTest {

    @Test
    fun `eine fertige Anleitung wird nicht noch einmal angefragt`() {
        // DER Fall aus der Meldung: 12 MB liegen fertig da.
        val s = pdfStep(finishedSize = 12_000_000L, partSize = 0L)
        assert(s is PdfStep.Fertig) {
            "Eine vollstaendige Anleitung ergab $s. Damit schickt der Viewer " +
                "wieder einen Bereich hinter dem Dateiende — genau Marcos 404."
        }
    }

    @Test
    fun `eine Teildatei wird an ihrem Ende fortgesetzt`() {
        // Der Fall, fuer den das Fortsetzen ueberhaupt da ist: Die Verbindung
        // brach bei 3 MB ab. Faellt dieser Schritt, laedt jede abgebrochene
        // 300-MB-Anleitung wieder von vorn.
        val s = pdfStep(finishedSize = 0L, partSize = 3_000_000L)
        assert(s == PdfStep.Holen(3_000_000L)) { "Teildatei ergab $s statt Holen(3000000)" }
    }

    @Test
    fun `ohne alles wird von vorn geladen`() {
        val s = pdfStep(finishedSize = 0L, partSize = 0L)
        assert(s == PdfStep.Holen(0L)) { "Leerer Cache ergab $s statt Holen(0)" }
    }

    @Test
    fun `eine Teildatei neben der fertigen aendert nichts`() {
        // Kann vorkommen, wenn ein zweiter Download angefangen wurde, waehrend
        // der erste schon fertig war. Die fertige Datei gewinnt; die Teildatei
        // raeumt prunePdfCache weg.
        val s = pdfStep(finishedSize = 12_000_000L, partSize = 3_000_000L)
        assert(s is PdfStep.Fertig) { "Fertig + Teildatei ergab $s" }
    }
}
