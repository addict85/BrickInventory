package ch.brickinventoryapp

import ch.brickinventoryapp.ui.screens.setNumberCandidates
import org.json.JSONObject
import org.junit.Test

/**
 * Der GEMEINSAME Korpus: Web-App und Android-App muessen dieselbe Setnummer
 * lesen.
 *
 * ── Warum eine gemeinsame Datei ─────────────────────────────────────────────
 *
 * Dieselbe Frage — „welche Zahl in diesem Text ist die Setnummer?" — wird
 * zweimal beantwortet: hier in Kotlin fuer die Texterkennung (offline, in der
 * Kameraschleife) und in Web-App/utils/produkttitel.ts fuer Haendlertitel. Ein
 * gemeinsamer Aufruf geht nicht; ein gemeinsamer PRUEFKORPUS schon.
 *
 * GEMESSEN, bevor es ihn gab:
 *
 *   Regel                                    Server   App
 *   Mengenangabe („3696 Pcs") aussortieren     ja     NEIN
 *   Jahreszahl zuruecksetzen                   ja     NEIN
 *   nach Stellenzahl ordnen                   NEIN     ja
 *   dreistellige Setnummern (375, 928)        NEIN    NEIN
 *
 * Beide Fassungen beantworteten dieselbe Frage unterschiedlich, und keine
 * Pruefung sagte etwas dazu.
 *
 * ── Warum hier nichts aufgezaehlt steht ─────────────────────────────────────
 *
 * Die Faelle stehen in shared/setnummer-korpus.json, samt Begruendung je Fall.
 * Ein neuer Fall wird EINMAL eingetragen und prueft ab sofort beide Apps.
 * Die Gegenprobe auf der anderen Seite ist Web-App/test/setnummer-korpus.test.js.
 *
 * Selbstbeweis ueber Mindestzahlen: Ginge das Einlesen schief, waere die
 * Schleife leer und der Test gruen, ohne etwas geprueft zu haben.
 */
class SetnummerKorpusTest {

    /** Pfad relativ zum Modulverzeichnis `Android-App/app` — wie in ApkNameTest. */
    private val korpus by lazy {
        JSONObject(java.io.File("../../shared/setnummer-korpus.json").readText())
            .getJSONArray("faelle")
    }

    @Test
    fun `jeder Fall des gemeinsamen Korpus liefert denselben ersten Kandidaten`() {
        var mitErwartung = 0
        var ohneKandidat = 0
        var dreistellig = 0
        for (i in 0 until korpus.length()) {
            val fall = korpus.getJSONObject(i)
            val text = fall.getString("text")
            val erwartet = if (fall.isNull("erwartet")) null else fall.getString("erwartet")
            val warum = fall.getString("warum")
            val k = setNumberCandidates(text)
            val ist = k.firstOrNull()
            assert(ist == erwartet) {
                "Korpusfall $i: ${text.replace("\n", "\\n")}\n" +
                "  erwartet: $erwartet\n  bekommen: $ist  (alle: $k)\n  warum: $warum"
            }
            if (erwartet == null) ohneKandidat++ else mitErwartung++
            if (erwartet != null && erwartet.length == 3) dreistellig++
        }

        // Selbstbeweis 1: Der Korpus wurde wirklich gelesen und ist nicht leer.
        assert(korpus.length() >= 15) {
            "Nur ${korpus.length()} Faelle im Korpus — Datei geschrumpft oder falscher Pfad?"
        }
        // Selbstbeweis 2: Beide Richtungen sind vertreten. Ohne das koennte der
        // Korpus zu lauter Nulltreffern verkommen und trotzdem gruen sein.
        assert(mitErwartung >= 10) { "nur $mitErwartung Faelle mit erwarteter Nummer" }
        assert(ohneKandidat >= 2) { "nur $ohneKandidat Faelle, die gar nichts liefern duerfen" }
        // Selbstbeweis 3: Der Anlass dieser Runde — dreistellige Altsets — ist
        // abgedeckt. Faellt die Unterstuetzung wieder raus, wird es rot.
        assert(dreistellig >= 2) { "nur $dreistellig dreistellige Setnummern im Korpus" }
    }
}
