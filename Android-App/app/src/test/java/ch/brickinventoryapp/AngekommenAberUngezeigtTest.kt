package ch.brickinventoryapp

import org.junit.Test

/**
 * Werte, die ueber die Leitung kommen und niemanden erreichen.
 *
 * ── Woher dieser Test kommt (Nachtrag 141) ──────────────────────────────────
 *
 * Eine neue Messung, die es vorher nicht gab: WELCHE Felder der
 * Antwort-Modelle liest die App nirgends? Die bestehenden Regeln fragen das
 * von der anderen Seite — UiStateFieldsTest findet Zustandsfelder, die
 * geschrieben und nie gelesen werden. Ein Feld, das der SERVER schickt, das
 * Modell auspackt und dann niemand ansieht, sah bisher keine Pruefung.
 *
 * Gemessen: 121 Modellklassen, 612 Felder, 50 davon liest niemand. Zwei davon
 * waren echte Luecken — beide sind hier festgehalten:
 *
 *   ProtokollZeile.loggedAt        die Uhrzeit im Verwaltungs-Protokoll
 *   DashboardStats.totalInstructions  die vierte Zahl im Kopf der Galerie
 *
 * ── Warum daraus KEINE allgemeine Regel wurde ───────────────────────────────
 *
 * „Jedes Modellfeld muss gelesen werden" waere falsch: Ein Modell bildet die
 * Antwort ab, und nicht jede Antwort wird ganz gebraucht. 48 Felder stehen
 * weiterhin ungelesen da, jedes zu Recht — Minimal- und Maximalpreise, die
 * keine Oberflaeche zeigt, Rueckgabewerte von Schreibaufrufen, Angaben fuer
 * Faelle, die die App gar nicht hat. Eine Regel, die 48 richtige Stellen
 * anmeckert, wird abgeschaltet statt befolgt.
 *
 * Die Messung bleibt trotzdem als Werkzeug (scratchpad/ungelesen.py): Sie sagt,
 * WO man nachsehen soll. Die Entscheidung faellt der Vergleich mit der Webapp
 * — zeigt SIE den Wert, ist es eine Luecke; zeigt ihn keiner von beiden, ist
 * es Ballast.
 *
 * Der Test liest nur Quelltext: kein Geraet, kein Compose.
 */
class AngekommenAberUngezeigtTest {

    /**
     * Das Protokoll zeigt die Uhrzeit.
     *
     * Die Weboberflaeche tut es seit jeher (public/js/logviewer.js,
     * toLocaleTimeString); die App zeigte nur Stufe und Meldung. „Ist das von
     * eben oder von gestern?" ist die erste Frage, die man an ein Protokoll
     * hat — ohne Zeitangabe ist eine Zeile kaum zu gebrauchen.
     */
    @Test
    fun `das Protokoll zeigt die Uhrzeit jeder Zeile`() {
        val src = Quellen.ohneKommentare(Quellen.lies("ui/screens/MonitoringSections.kt"))
        assert(src.contains("fmtUhrzeit(zeile.loggedAt)")) {
            "Die Protokollzeile zeigt die Uhrzeit nicht mehr — das Feld logged_at kommt " +
                "seit jeher mit, und die Weboberflaeche zeigt es"
        }
    }

    /**
     * Stufenfilter und Suche — auch die hat die Weboberflaeche und die App nicht.
     *
     * Bei 1440 Minuten sind es schnell hunderte Zeilen. Gefiltert wird im
     * Geraet und nicht auf dem Server: Die Zeilen liegen schon vor, ein
     * zweiter Abruf je Tastendruck waere nur Wartezeit.
     */
    @Test
    fun `das Protokoll laesst sich filtern und durchsuchen`() {
        val src = Quellen.ohneKommentare(Quellen.lies("ui/screens/MonitoringSections.kt"))
        assert(src.contains("versteckteStufen")) { "Der Stufenfilter des Protokolls fehlt" }
        assert(src.contains("R.string.admin_log_search")) { "Das Suchfeld des Protokolls fehlt" }
    }

    /**
     * Die Galerie zeigt die Zahl der Anleitungen.
     *
     * Die Weboberflaeche zeigt im Kopf vier Zahlen (02-gallery.js: `hs-sets`,
     * `hs-parts`, `hs-minifigs`, `hs-instr`), die App zeigte drei davon plus
     * die Einheiten. `total_instructions` kam mit und wurde nirgends gelesen.
     */
    @Test
    fun `die Galerie zeigt die Zahl der Anleitungen`() {
        val src = Quellen.ohneKommentare(Quellen.lies("ui/screens/GalleryScreen.kt"))
        assert(src.contains("stats.totalInstructions")) {
            "Der Kopf der Galerie zeigt die Anleitungen nicht — die Weboberflaeche tut es"
        }
    }
}
