package ch.brickinventoryapp

import org.junit.Test

/**
 * Wer etwas erfasst oder löscht, lädt auch nach, was die Zahl anzeigt.
 *
 * ── Dreimal derselbe Fehler ─────────────────────────────────────────────────
 * Diese Regel ist in dieser Reihe dreimal gebrochen worden, und jedes Mal war
 * das Symptom dasselbe: eine Zahl, die stehen bleibt, bis der Reiter neu
 * geöffnet wird.
 *
 *  1. `reloadItemList()` rief AUSSCHLIESSLICH loadValuation() auf — sie lud nie
 *     eine Liste, obwohl ihr Name genau das verspricht. Der Kommentar dort:
 *     „Der Name hat den Fehler dabei verdeckt: An den Aufrufstellen sah es aus,
 *     als sei die Liste versorgt."
 *
 *  2. Der Barcode-Weg lud nach dem Erfassen nur die Set-Liste. Kommentar in
 *     BarcodeFeature.kt: „Kennzahlen und Bewertung ändern sich beim Erfassen
 *     ebenso — sie blieben bisher stehen, bis der jeweilige Reiter neu geöffnet
 *     wurde."
 *
 *  3. addPart/addMinifig/deletePart/deleteMinifig luden Liste und Bewertung,
 *     aber nicht die Kennzahlen. Die Galerie zeigt `total_parts` und
 *     `total_minifigs` aus genau diesen Kennzahlen; sie werden NUR von
 *     loadStats() erneuert, und loadDashboard() läuft bei der Anmeldung, nicht
 *     beim Reiterwechsel. Wer ein Teil erfasste und zur Galerie wechselte, sah
 *     dort den alten Stand.
 *
 * Der dritte Fall ist beim mechanischen Vergleich der Erfassungswege
 * aufgefallen — nicht beim Lesen. Sets luden zu dritt nach, Teile und
 * Minifiguren zu zweit.
 *
 * ── Was geprüft wird ────────────────────────────────────────────────────────
 * Jede Funktion des ViewModels, die etwas anlegt oder löscht und daraufhin eine
 * LISTE nachlädt, muss auch die Kennzahlen nachladen — entweder selbst oder
 * über reloadItemList(), das beides tut.
 *
 * Die Funktionen werden gefunden, nicht aufgezählt.
 */
class ErfassungNachladenTest {

    private fun featureDateien(): List<java.io.File> {
        val ordner = java.io.File("src/main/java/ch/brickinventoryapp/ui")
        val treffer = (ordner.listFiles { f -> f.name.endsWith("Feature.kt") } ?: emptyArray()).toList()
        assert(treffer.size >= 5) {
            "Nur ${treffer.size} *Feature.kt gefunden — der Pfad stimmt nicht, und ein " +
                "leeres Ergebnis würde diesen Test stillschweigend bestehen lassen."
        }
        return treffer
    }

    /** Die Rümpfe aller anlegenden und löschenden Funktionen, je Name. */
    private fun erfassungsWege(): Map<String, String> {
        val ergebnis = linkedMapOf<String, String>()
        for (datei in featureDateien()) {
            val src = Quellen.ohneKommentare(datei.readText())
            val muster = Regex("""internal fun MainViewModel\.((?:add|delete)\w+)\(""")
            for (m in muster.findAll(src)) {
                val start = m.range.first
                val ende = src.indexOf("\ninternal fun ", start + 10)
                ergebnis["${datei.name}:${m.groupValues[1]}"] =
                    src.substring(start, if (ende > start) ende else src.length)
            }
        }
        assert(ergebnis.size >= 6) {
            "Nur ${ergebnis.size} Erfassungs-/Löschwege gefunden — Muster veraltet?"
        }
        return ergebnis
    }

    @Test
    fun `wer eine Liste nachlaedt, laedt auch die Kennzahlen nach`() {
        val listenLader = Regex("""\bload(Sets|Parts|Minifigs)\(""")
        val fehlend = mutableListOf<String>()

        for ((name, rumpf) in erfassungsWege()) {
            if (!listenLader.containsMatchIn(rumpf)) continue          // ändert keine Liste
            if (rumpf.contains("reloadItemList(")) continue            // erledigt beides
            if (rumpf.contains("loadStats(")) continue
            fehlend += name
        }

        assert(fehlend.isEmpty()) {
            "Diese Wege laden eine Liste nach, aber nicht die Kennzahlen:\n  " +
                fehlend.joinToString("\n  ") +
                "\nDie Galerie zeigt total_parts/total_minifigs aus den Kennzahlen; " +
                "ohne loadStats() bleibt die Zahl stehen, bis jemand herunterzieht."
        }
    }

    @Test
    fun `reloadItemList laedt Liste, Bewertung UND Kennzahlen`() {
        // Der Helfer ist die eine Stelle, auf die sich die Wege oben verlassen.
        // Fehlt ihm eines der drei, sind alle Aufrufer betroffen — und keiner
        // von ihnen sieht es.
        val src = Quellen.ohneKommentare(Quellen.lies("ui/ManualItemFeature.kt"))
        val i = src.indexOf("internal fun MainViewModel.reloadItemList(")
        assert(i >= 0) { "reloadItemList() nicht gefunden" }
        val rumpf = src.substring(i, src.indexOf("\n}", i))

        for (noetig in listOf("loadMinifigs(", "loadParts(", "loadValuation(", "loadStats(")) {
            assert(rumpf.contains(noetig)) {
                "reloadItemList() ruft $noetig nicht mehr — alle Aufrufer verlieren " +
                    "damit stillschweigend eine Aktualisierung."
            }
        }
    }
}
