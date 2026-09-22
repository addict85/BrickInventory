package ch.brickinventoryapp

import ch.brickinventoryapp.util.PdfSchritt
import ch.brickinventoryapp.util.pdfSchritt
import org.junit.Test

/**
 * Eine fertig geladene Anleitung wird nicht „fortgesetzt".
 *
 * ── Marcos Meldung ──────────────────────────────────────────────────────────
 *
 * „Nach ein paar Mal die Anleitung abrufen aus der App erscheint folgende
 * Meldung" — „Fehler beim Laden: HTTP 404". Die Anleitung lag die ganze Zeit
 * auf dem Server.
 *
 * ── Der Ablauf, der dahin fuehrte ───────────────────────────────────────────
 *
 *  1. Der Viewer laedt fortsetzbar: Liegt im Cache schon etwas, schickt er
 *     `Range: bytes=<vorhanden>-`.
 *  2. Nach einem VOLLSTAENDIGEN Download ist `vorhanden` genau die
 *     Dateigroesse. Der Bereich beginnt hinter dem letzten Byte.
 *  3. Der Server antwortet 416 („diesen Bereich gibt es nicht") — und die
 *     Anleitungs-Route machte daraus eine 404.
 *  4. Acht Versuche, achtmal dasselbe. Anzeige: „HTTP 404".
 *
 * NACHGEMESSEN auf der Serverseite (express 4.22.3 / send 0.19.2, Datei mit
 * 5000 Bytes): `bytes=2500-` → 206, `bytes=5000-` → 416. Beide Haelften sind
 * repariert; die Serverhaelfte haelt Web-App/test/anleitung-bereich.test.js
 * fest, diese hier die App-Haelfte.
 *
 * ── Warum eine eigene Funktion dafuer ───────────────────────────────────────
 *
 * Die Entscheidung „fertig oder ab welchem Byte" liess sich vorher nicht
 * pruefen: Sie stand als zwei Zeilen mitten in einer Schleife, die Netz,
 * Dateisystem und Compose-Zustand anfasst. Ohne Android-SDK ist davon nichts
 * ausfuehrbar. Als reine Funktion ist sie es — und genau sie war falsch.
 *
 * Gegenprobe (durchgefuehrt): in pdfSchritt() den ersten Zweig entfernt, so
 * dass eine fertige Datei wieder als Fortsetzpunkt gilt → der erste Schritt
 * unten wird rot.
 */
class PdfCacheTest {

    @Test
    fun `eine fertige Anleitung wird nicht noch einmal angefragt`() {
        // DER Fall aus der Meldung: 12 MB liegen fertig da.
        val s = pdfSchritt(fertigeGroesse = 12_000_000L, teilGroesse = 0L)
        assert(s is PdfSchritt.Fertig) {
            "Eine vollstaendige Anleitung ergab $s. Damit schickt der Viewer " +
                "wieder einen Bereich hinter dem Dateiende — genau Marcos 404."
        }
    }

    @Test
    fun `eine Teildatei wird an ihrem Ende fortgesetzt`() {
        // Der Fall, fuer den das Fortsetzen ueberhaupt da ist: Die Verbindung
        // brach bei 3 MB ab. Faellt dieser Schritt, laedt jede abgebrochene
        // 300-MB-Anleitung wieder von vorn.
        val s = pdfSchritt(fertigeGroesse = 0L, teilGroesse = 3_000_000L)
        assert(s == PdfSchritt.Holen(3_000_000L)) { "Teildatei ergab $s statt Holen(3000000)" }
    }

    @Test
    fun `ohne alles wird von vorn geladen`() {
        val s = pdfSchritt(fertigeGroesse = 0L, teilGroesse = 0L)
        assert(s == PdfSchritt.Holen(0L)) { "Leerer Cache ergab $s statt Holen(0)" }
    }

    @Test
    fun `eine Teildatei neben der fertigen aendert nichts`() {
        // Kann vorkommen, wenn ein zweiter Download angefangen wurde, waehrend
        // der erste schon fertig war. Die fertige Datei gewinnt; die Teildatei
        // raeumt prunePdfCache weg.
        val s = pdfSchritt(fertigeGroesse = 12_000_000L, teilGroesse = 3_000_000L)
        assert(s is PdfSchritt.Fertig) { "Fertig + Teildatei ergab $s" }
    }

    /**
     * Und die Verdrahtung: Der Download muss in die TEILDATEI schreiben.
     *
     * Die Funktion oben kann noch so richtig entscheiden — schriebe die
     * Schleife weiterhin direkt in die fertige Datei, waere die Unterscheidung
     * wertlos, weil ein abgebrochener Download dann wieder unter dem fertigen
     * Namen laege. Das ist keine zweite Fassung derselben Regel, sondern die
     * Voraussetzung dafuer, dass die erste ueberhaupt etwas bedeutet.
     */
    @Test
    fun `der Download schreibt in die Teildatei und benennt erst am Ende um`() {
        val src = Quellen.ohneKommentare(Quellen.lies("ui/screens/PdfViewerScreen.kt"))
        assert(src.contains("""val teil = File(dest.path + ".part")""")) {
            "Die Teildatei wird nicht mehr angelegt — schreibt der Download wieder direkt ins Ziel?"
        }
        assert(src.contains("RandomAccessFile(teil,")) {
            "Der Download schreibt nicht in die Teildatei. Dann ist ein Abbruch " +
                "wieder nicht von einem fertigen Download zu unterscheiden."
        }
        assert(!src.contains("RandomAccessFile(dest,")) {
            "Es wird (auch) direkt in die fertige Datei geschrieben."
        }
        assert(src.contains("teil.renameTo(dest)")) {
            "Das Umbenennen am Ende fehlt — dann entsteht die fertige Datei nie."
        }
    }
}
