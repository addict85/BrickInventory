package ch.brickinventoryapp

import org.junit.Test

/**
 * Die Oberflächen rechnen nicht — sie zeigen an.
 *
 * ── Woher dieser Test kommt (Marcos Frage) ──────────────────────────────────
 * „Kannst du sicherstellen, dass Berechnungen zentral in einer Komponente für
 * Webapp und Android-App durchgeführt werden, damit die GUIs nur das Rendering
 * übernehmen müssen?"
 *
 * Zwei Rechnungen standen noch in dieser App, und beide zeigten dadurch etwas
 * anderes als die Webapp:
 *
 *   • Die Summenzeile der Erfassungen (Menge und Betrag) — dieselbe Rechnung
 *     stand nochmal zweimal in der Webapp, und die vier Fassungen lasen den
 *     Preis aus verschiedenen Feldern.
 *   • Die drei Kacheln im Minifiguren-Reiter. Sie rechneten über `figs`, und
 *     diese Liste ist gefiltert (`source != "manual"`). „Manuell erfasst"
 *     konnte damit gar nichts anderes als 0 ergeben.
 *
 * Der Test hält das Ergebnis nicht fest (das prüft die Serverseite), sondern
 * die REGEL: Diese Zahlen kommen aus der Antwort, nicht aus einer Schleife
 * über die Liste. Genau die Regel ist das, was beim nächsten neuen Bildschirm
 * zählt.
 *
 * Gegenprobe (durchgeführt): in AcquisitionManagementScreen wieder
 * `acquisitions.sumOf { it.quantity }` eingesetzt → der erste Teilschritt wird
 * rot; in MinifigsScreen wieder `figs.size` → der zweite.
 */
class ServerComputedValuesTest {

    private fun read(rel: String) =
        java.io.File("src/main/java/ch/brickinventoryapp/$rel").readText()

    /** Kommentare zeilenweise ausblenden — sonst hält der eigene Erklärtext die Prüfung grün. */
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `die Summenzeile der Erfassungen kommt vom Server`() {
        for (f in listOf(
            "ui/screens/AcquisitionManagementScreen.kt",
            "ui/screens/ManualItemComposables.kt",
        )) {
            val c = code(read(f))
            assert(!c.contains("acquisitions.sumOf")) {
                "$f summiert die Erfassungen selbst — die Summe kommt als `totals` " +
                    "aus der Antwort (utils/acquisitions.ts, acquisitionTotals)"
            }
        }
        val acq = code(read("ui/screens/AcquisitionManagementScreen.kt"))
        assert(acq.contains("totals.quantity")) { "Die Menge muss aus totals kommen" }
        assert(acq.contains("totals.amount")) { "Der Betrag muss aus totals kommen" }
        // Gegenrichtung: `amount` ist nullable, und die Ansicht darf daraus keine
        // 0 machen — „nichts erfasst" und „für null gekauft" sind verschieden.
        assert(acq.contains("totals.amount?.let")) {
            "Der fehlende Betrag muss als null behandelt werden, nicht als 0"
        }
    }

    @Test
    fun `die Antwort traegt die Summe, mit sicherer Vorgabe`() {
        val m = code(read("data/model/Models.kt"))
        assert(m.contains("data class AcquisitionTotals")) { "AcquisitionTotals fehlt im Modell" }
        assert(Regex("""val totals: AcquisitionTotals = AcquisitionTotals\(\)""").containsMatchIn(m)) {
            "Ohne Vorgabe scheitert die Antwort älterer Serverstände an der Deserialisierung"
        }
    }

    @Test
    fun `die Minifiguren-Kacheln kommen vom Server, nicht aus der gefilterten Liste`() {
        val s = code(read("ui/screens/MinifigsScreen.kt"))
        for (muster in listOf("figs.size", "figs.sumOf", "figs.count")) {
            assert(!s.contains(muster)) {
                "MinifigsScreen rechnet die Kacheln aus `figs` ($muster). Diese Liste ist " +
                    "gefiltert — die Kachel „manuell erfasst\" stünde damit immer auf 0."
            }
        }
        assert(s.contains("minifigStats.types") &&
               s.contains("minifigStats.totalQuantity") &&
               s.contains("minifigStats.manual")) {
            "Alle drei Kacheln müssen aus den Server-Kennzahlen kommen"
        }
    }

    @Test
    fun `der Mengenregler folgt der Serverantwort, nicht der eigenen Annahme`() {
        // ── Warum ───────────────────────────────────────────────────────────
        // Angezeigt wird die Menge ALLER Konten, geschrieben wird die Differenz
        // auf das eigene (Nachtrag 85). Beim Verringern deckelt der Server bei
        // den eigenen Exemplaren — fremde lassen sich nicht wegnehmen — und
        // antwortet mit der tatsächlichen Gesamtmenge.
        //
        // Der Regler zählt seine Zahl vorher hoch. Ohne die Übernahme stünde
        // nach einem gedeckelten Verringern die eigene Annahme da, bis jemand
        // die Ansicht neu öffnet: Der Server hat recht, der Bildschirm zeigt
        // etwas anderes, und niemand merkt es.
        //
        // Dieselbe Lücke ist hier schon zweimal aufgefallen — die
        // Verschiebe-Zahlen und das Zustands-Aggregat lieferte der Server
        // seit jeher mit, und die App las sie nie.
        val m = code(read("data/model/Models.kt"))
        assert(m.contains("val quantity: Int? = null")) {
            "GenericResponse hat kein nullable quantity — dann kann die Antwort " +
                "die wirkliche Gesamtmenge gar nicht transportieren"
        }

        val g = code(read("ui/GalleryFeature.kt"))
        val block = g.substring(g.indexOf("fun MainViewModel.updateQuantity("))
            .substringBefore("internal fun MainViewModel.delete")
        assert(block.contains("r.data.quantity")) {
            "updateQuantity liest die Menge der Antwort nicht"
        }
        val uebernahme = block.indexOf("r.data.quantity")
        val laden = block.indexOf("loadSets()")
        assert(laden < 0 || uebernahme < laden) {
            "Die Übernahme muss VOR dem Nachladen stehen — sonst sieht man die " +
                "falsche Zahl für die Dauer einer Rundreise"
        }

        // Und der Regler muss der Zahl aus dem Zustand folgen. Hinge sein
        // `remember` nur an der Setnummer, behielte er seinen alten Wert,
        // obwohl der Zustand längst korrigiert ist.
        val d = code(read("ui/screens/SetDetailScreen.kt"))
        assert(d.contains("remember(set.setNumber, set.quantity)")) {
            "Der Mengenregler ist nicht an set.quantity gekoppelt"
        }
    }

    @Test
    fun `die Kennzahlen werden neben der Liste geladen und ueberleben einen Fehlschlag`() {
        val f = code(read("ui/PartsFeature.kt"))
        assert(f.contains("repo.getMinifigStats(")) { "Der Abruf der Kennzahlen fehlt" }
        assert(f.contains("scopeFor(ScopeFilter.View.MINIFIGS)")) {
            "Die Kennzahlen müssen denselben Kontofilter tragen wie die Liste — sonst " +
                "steht eine Zahl aus einem Blickfeld über einer Liste aus einem anderen"
        }
        // Eigener launch: Die Liste soll nicht auf die Zählung warten.
        val stelle = f.indexOf("repo.getMinifigStats(")
        val davor = f.substring(maxOf(0, stelle - 400), stelle)
        assert(davor.contains("viewModelScope.launch")) {
            "Der Abruf gehört in einen eigenen launch — sonst wartet die Liste auf ihn"
        }
    }
}
