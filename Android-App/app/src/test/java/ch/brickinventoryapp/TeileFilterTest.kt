package ch.brickinventoryapp

import org.junit.Test

/**
 * Der Teile-Reiter filtert nach Farbe und Kategorie — wie die Webapp.
 *
 * ── Woher dieser Test kommt (Nachtrag 134) ──────────────────────────────────
 *
 * Gemessen, nicht gelesen: Ein Vergleich der Server-Adressen beider Clients
 * (Retrofit-Annotationen gegen `api(...)` und `fetch(...)` in public/js)
 * meldete 21 Adressen, die NUR die Webapp ruft. Zwei davon sind
 * /v1/parts/colors und /v1/parts/categories — die beiden Filterlisten des
 * Teile-Reiters, jede mit Zaehlwerten daneben.
 *
 * Die App bot dort ausschliesslich die Suche. Bei tausenden Teilen ist die
 * Farbe der naheliegendste Weg, ueberhaupt etwas wiederzufinden.
 *
 * ── Der eigentlich bemerkenswerte Teil ──────────────────────────────────────
 *
 * Die Leitung lag bereits: `BrickApiService.getParts` deklariert
 * `@Query("color")` und `@Query("category")` seit jeher, und
 * `TeileRepository.getParts` reicht beide durch. GESETZT hat sie nie jemand.
 *
 * Eine halbfertige Funktion faellt in keiner der bestehenden Pruefungen auf:
 * Ein Parameter mit Vorgabewert ist kein toter Code, und ein Zustandsfeld gab
 * es dafuer nicht. Deshalb dieser Test — er haelt fest, dass die beiden Werte
 * auch WIRKLICH mitgeschickt werden.
 *
 * Der Test liest nur Quelltext: kein Geraet, kein Compose.
 */
class TeileFilterTest {

    private fun read(rel: String) =
        java.io.File("src/main/java/ch/brickinventoryapp/$rel").readText()
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `die App ruft beide Filterlisten`() {
        val api = code(read("data/api/BrickApiService.kt"))
        for (adresse in listOf("api/v1/parts/colors", "api/v1/parts/categories")) {
            assert(api.contains("@GET(\"$adresse\")")) { "Die App ruft $adresse nicht" }
        }
        // Beide mit `accounts`: Sonst zaehlten sie im Haushalt anders als die
        // Liste darunter — genau der Fehler, den der Server dabei hatte.
        val ausschnitt = api.substringAfter("api/v1/parts/colors").take(600)
        assert(ausschnitt.contains("@Query(\"accounts\")")) {
            "Die Farbliste reist ohne Blickfeld — im Haushalt zaehlt sie dann anders als die Liste"
        }
    }

    @Test
    fun `die gewaehlten Filter reisen mit der Teileliste mit`() {
        val s = code(read("ui/PartsFeature.kt"))
        // Aus dem ZUSTAND gelesen, nicht als Parameter: Sonst kaemen sie beim
        // Nachladen von Seite 2 nicht mit, und eine ungefilterte Seite haengt
        // sich an eine gefilterte.
        assert(s.contains("_partsState.value.partsColorFilter.ifBlank { null }")) {
            "Der Farbfilter wird nicht aus dem Zustand gelesen"
        }
        assert(s.contains("_partsState.value.partsCategoryFilter.ifBlank { null }")) {
            "Der Kategoriefilter wird nicht aus dem Zustand gelesen"
        }
        assert(s.contains("color = farbe")) { "Der Farbfilter wird nicht mitgeschickt" }
        assert(s.contains("category = kategorie")) { "Der Kategoriefilter wird nicht mitgeschickt" }
    }

    @Test
    fun `ein Filterwechsel vergisst die Scrollstelle`() {
        // Dieselbe Regel wie beim Ersatzteil-Filter daneben: Die gemerkte
        // Stelle zeigt auf Teile, die in der neuen Liste woanders oder gar
        // nicht stehen.
        val s = code(read("ui/PartsFeature.kt"))
        val setzer = listOf("setPartsColorFilter", "setPartsCategoryFilter")
        for (name in setzer) {
            val ab = s.indexOf("fun MainViewModel.$name(")
            assert(ab > 0) { "$name fehlt" }
            val rumpf = s.substring(ab, minOf(ab + 400, s.length))
            assert(rumpf.contains("scrollMemory.vergiss(\"parts\")")) {
                "$name vergisst die Scrollstelle nicht"
            }
            assert(rumpf.contains("loadParts(page = 1)")) {
                "$name laedt nicht ab Seite 1 — sonst bliebe die alte Seitenzahl stehen"
            }
        }
    }
}

/**
 * Der CSV-Import laesst sich abbrechen — wie in der Webapp.
 *
 * ── Woher dieser Test kommt (Nachtrag 134) ──────────────────────────────────
 *
 * Aus derselben Messung wie die Filter darueber: /v1/sets/import/csv/cancel
 * war eine von 21 Server-Adressen, die nur die Webapp ruft. Die App zeigte
 * denselben Fortschrittsbalken (CsvImportBanner) und bot keinen Weg heraus —
 * ein versehentlich gestarteter Import ueber hunderte Sets holt zu jedem die
 * Stammdaten und musste ausgesessen werden.
 */
class CsvAbbruchTest {

    private fun read(rel: String) =
        java.io.File("src/main/java/ch/brickinventoryapp/$rel").readText()
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `die App kennt die Abbruch-Adresse`() {
        val api = code(read("data/api/BrickApiService.kt"))
        assert(api.contains("@POST(\"api/v1/sets/import/csv/cancel\")")) {
            "Die App ruft die Abbruch-Adresse nicht"
        }
    }

    @Test
    fun `der Abbruch meldet seinen Fehler`() {
        // Dieselbe Regel wie fuer jede andere aendernde Handlung
        // (AktionMeldetFehlerTest): Scheitert sie lautlos, tippt der Nutzer
        // weiter und wundert sich, dass der Balken laeuft.
        val s = code(read("ui/CsvImportFeature.kt"))
        val ab = s.indexOf("fun MainViewModel.cancelCsvImport(")
        assert(ab > 0) { "cancelCsvImport fehlt" }
        val rumpf = s.substring(ab, minOf(ab + 500, s.length))
        assert(rumpf.contains("_snackbar.value = meldung(r)")) {
            "Der Abbruch scheitert lautlos"
        }
    }

    @Test
    fun `der Knopf steht in der Kopfzeile, nicht im aufgeklappten Teil`() {
        // Wer abbrechen will, soll nicht erst herausfinden muessen, dass der
        // Balken sich aufklappen laesst. In der Webapp steht der Knopf
        // dauerhaft da (btn-cancel-import).
        val s = code(read("ui/screens/CsvImportBanner.kt"))
        val knopf = s.indexOf("R.string.csv_cancel")
        val aufgeklappt = s.indexOf("if (expanded) {")
        assert(knopf > 0) { "Der Abbrechen-Knopf fehlt" }
        assert(aufgeklappt > 0) { "Der aufklappbare Teil fehlt — Test veraltet?" }
        assert(knopf < aufgeklappt) {
            "Der Abbrechen-Knopf steht im aufgeklappten Teil und ist damit versteckt"
        }
    }
}
