package ch.brickinventoryapp

import org.junit.Test

/**
 * Zwei Handlungen im Set-Detail, die nur die Webapp konnte.
 *
 * ── Woher dieser Test kommt (Nachtrag 159) ──────────────────────────────────
 *
 * Aus derselben Messung wie VerwaltungLueckenTest — Server-Adressen beider
 * Oberflaechen gegeneinander —, nur ist sie diesmal keine Handmessung mehr:
 * test/webapp-endpunkte.test.js im Manager fuehrt die Liste „das kann nur die
 * Webapp" jetzt MIT BEGRUENDUNG und besteht darauf, dass jede noch einen
 * Gegenstand hat. Uebrig blieben zwei Adressen ohne Grund:
 *
 *   POST /v1/sets/{nr}/instructions   Anleitungen verwerfen und neu suchen
 *   POST /v1/sets/{nr}/parts          Teileliste neu einlesen
 *
 * Beide gehoeren zu einem Bildschirm, den die App laengst hat. Die Webapp
 * bietet sie seit jeher an (02-gallery.js: redownloadInstr, reimportParts).
 *
 * ── Warum das mehr ist als Bequemlichkeit ───────────────────────────────────
 *
 * Ein Set, das eingetragen wird, bevor der Katalog seine Teile kennt, steht
 * dauerhaft auf 0 Teilen — und nichts holt das von selbst nach. Dasselbe bei
 * einer Anleitung, deren Link ins Leere zeigt. Ohne diese beiden Knoepfe blieb
 * dem App-Nutzer nur, jede Anleitung von Hand hochzuladen, und bei den Teilen
 * gar nichts.
 *
 * Der Test liest nur Quelltext: kein Geraet, kein Compose.
 */
class SetNachladenTest {

    @Test
    fun `die App kennt beide Adressen`() {
        val api = Quellen.ohneKommentare(Quellen.lies("data/api/BrickApiService.kt"))
        for (adresse in listOf(
            "api/v1/sets/{setNumber}/instructions",
            "api/v1/sets/{setNumber}/parts",
        )) {
            assert(api.contains("@POST(\"$adresse\")")) {
                "Die App ruft POST $adresse nicht — die Webapp tut es seit jeher"
            }
        }
    }

    /**
     * Beide Knoepfe stehen im Set-Detail.
     *
     * Nicht in einem Verwaltungsbildschirm: Sie beziehen sich auf GENAU DIESES
     * Set, und die Webapp haengt sie aus demselben Grund an dessen Detailkarte.
     */
    @Test
    fun `das Set-Detail bietet beide Knoepfe an`() {
        val src = Quellen.ohneKommentare(Quellen.lies("ui/screens/SetDetailSections.kt"))
        assert(src.contains("R.string.instr_reload")) {
            "Im Anleitungs-Abschnitt fehlt der Knopf zum Neusuchen"
        }
        assert(src.contains("R.string.parts_reimport")) {
            "In den Stammdaten fehlt der Knopf zum Neueinlesen der Teile"
        }
    }

    /**
     * Die Zahl aus der Antwort wird GEMELDET.
     *
     * `count` ist die einzige Rueckmeldung, die es gibt. „0 Teile eingelesen"
     * heisst, dass der Katalog zu diesem Set nichts weiss — genau der Fall, um
     * dessentwillen man den Knopf drueckt. Ein blosses „fertig" verschwiege
     * ihn.
     */
    @Test
    fun `beide melden, wie viel dabei herauskam`() {
        val src = Quellen.ohneKommentare(Quellen.lies("ui/SetDetailFeature.kt"))
        assert(src.contains("R.string.instr_reloaded_n")) { "Die Anleitungen melden keine Zahl" }
        assert(src.contains("R.string.parts_reimported_n")) { "Die Teile melden keine Zahl" }
    }

    /**
     * Nach dem Neueinlesen der Teile wird auch die TEILELISTE neu geladen.
     *
     * Die Teilezahl steht im Set-Detail, die Teile selbst im Teile-Reiter.
     * Nur das Detail nachzuladen hiesse: Der Chip zeigt 431, die Liste
     * daneben ist leer — und man drueckt den Knopf ein zweites Mal.
     */
    @Test
    fun `nach dem Neueinlesen ist auch die Teileliste aktuell`() {
        val src = Quellen.ohneKommentare(Quellen.lies("ui/SetDetailFeature.kt"))
        val i = src.indexOf("fun MainViewModel.teileNeuEinlesen")
        assert(i > 0) { "teileNeuEinlesen gibt es nicht mehr" }
        // Bis zur naechsten Deklaration auf oberster Ebene — in ZEILEN
        // gemessen und nicht in einem festen Zeichenfenster, aus dem Grund,
        // der im Kopf von Quellen.kt steht.
        val rumpf = src.substring(i).lineSequence().drop(1)
            .takeWhile { !it.startsWith("internal fun ") && !it.startsWith("private fun ") }
            .joinToString("\n")
        assert(rumpf.contains("loadParts()")) {
            "teileNeuEinlesen laedt die Teileliste nicht nach"
        }
    }
}
