package ch.brickinventoryapp

import org.junit.Test

/**
 * Doppelerfassung beim Barcode-Hinzufügen.
 *
 * Nutzerbeobachtung: "Da der Dialog träge reagiert wird oft 2x geklickt was
 * dazu führt, dass dann das Set doppelt erfasst wird."
 *
 * Die naheliegende Reparatur — `enabled` am Knopf — reicht allein **nicht**:
 * Sie greift erst, wenn Compose rekomponiert hat, und genau diese
 * Rekomposition ist die träge Stelle. Zwischen dem ersten Tippen und dem
 * gesperrten Knopf liegt ein Fenster, in dem der zweite Tipp durchkommt.
 *
 * Verbindlich ist deshalb die Sperre im ViewModel: `confirmAddBarcode()`
 * kehrt sofort um, wenn `barcodeAdding` schon gesetzt ist, und setzt das
 * Flag **synchron vor** `viewModelScope.launch`. Der Knopf-Zustand bleibt als
 * sichtbares Feedback zusätzlich bestehen.
 *
 * Dieser Test liest die Quellen — er braucht kein Gerät und kein Compose.
 */
class BarcodeDoubleAddGuardTest {

    private fun read(rel: String): String {
        val f = java.io.File("src/main/java/ch/brickinventoryapp/$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    /**
     * Kommentare ausblenden — die Erklärtexte oben nennen die geprüften
     * Muster selbst und würden den Test sonst grün färben, ohne dass der
     * Code sie enthält.
     */
    private fun code(src: String): String {
        val withoutBlocks = src.replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
        return withoutBlocks.lines()
            .filterNot { it.trim().startsWith("//") }
            .joinToString("\n")
    }

    @Test
    fun `BarcodeUiState kennt das adding-Flag`() {
        val src = code(read("ui/UiState.kt"))
        assert(Regex("""val\s+adding\s*:\s*Boolean""").containsMatchIn(src)) {
            "BarcodeUiState.adding fehlt — ohne das Flag gibt es keine Sperre " +
                "gegen den zweiten Klick im Barcode-Dialog"
        }
    }

    @Test
    fun `confirmAddBarcode kehrt beim zweiten Aufruf sofort um`() {
        val body = confirmAddBarcodeBody()
        assert(Regex("""if\s*\(\s*_barcodeState\.value\.adding\s*\)\s*return""").containsMatchIn(body)) {
            "confirmAddBarcode() prüft barcodeAdding nicht als Erstes — der zweite " +
                "Klick läuft durch und erfasst das Set ein zweites Mal"
        }
    }

    @Test
    fun `die Sperre steht vor viewModelScope launch, nicht darin`() {
        val body = confirmAddBarcodeBody()
        val setzt = body.indexOf("adding = true")
        val launch = body.indexOf("viewModelScope.launch")
        assert(setzt >= 0) { "confirmAddBarcode() setzt barcodeAdding nie auf true" }
        assert(launch >= 0) { "confirmAddBarcode() ohne viewModelScope.launch — Test veraltet?" }
        assert(setzt < launch) {
            "barcodeAdding wird erst innerhalb von viewModelScope.launch gesetzt. " +
                "Der Coroutine-Start ist asynchron: Zwei schnelle Klicks kommen " +
                "beide an der Prüfung vorbei, bevor der erste das Flag setzt. " +
                "Die Zuweisung muss synchron vor launch stehen."
        }
    }

    @Test
    fun `das Flag wird auf jedem Ausgang wieder freigegeben`() {
        val body = confirmAddBarcodeBody()
        val freigaben = Regex("""adding\s*=\s*false""").findAll(body).count()
        assert(freigaben >= 3) {
            "confirmAddBarcode() gibt barcodeAdding nur ${freigaben}x frei. Jeder " +
                "Ausgang (Erfolg, Fehler, sonstiges Ergebnis) muss zurücksetzen — " +
                "sonst bleibt der Knopf nach einem Fehler für immer gesperrt."
        }
        val cancel = code(read("ui/BarcodeFeature.kt"))
            .lines()
            .firstOrNull { it.contains("fun MainViewModel.cancelBarcode(") }
            ?: error("cancelBarcode() nicht gefunden — steht sie neu über mehrere Zeilen?")
        assert(cancel.contains("adding = false")) {
            "cancelBarcode() setzt barcodeAdding nicht zurück — nach einem Abbruch " +
                "bliebe der nächste Dialog gesperrt"
        }
    }

    @Test
    fun `der Knopf im Dialog ist waehrend des Hinzufuegens gesperrt`() {
        val src = code(read("AppNavigation.kt"))
        assert(src.contains("enabled = !barcodeState.adding")) {
            "Der Bestätigen-Knopf des Barcode-Dialogs wird nicht gesperrt — " +
                "der Nutzer bekommt kein Feedback und tippt weiter"
        }
        assert(Regex("""onDismissRequest\s*=\s*\{\s*if\s*\(!barcodeState\.adding\)""").containsMatchIn(src)) {
            "Der Barcode-Dialog lässt sich während des laufenden Hinzufügens " +
                "durch Tippen daneben schliessen"
        }
    }

    /** Reihenfolge der unteren Reiter — Vergleich steht hinter Katalog. */
    @Test
    fun `Vergleich steht in der Navigationsleiste hinter Katalog`() {
        val src = code(read("AppNavigation.kt"))
        val katalog = src.indexOf("Screen.Catalog,")
        val vergleich = src.indexOf("Screen.Comparison,")
        assert(katalog >= 0 && vergleich >= 0) { "Reiter-Einträge nicht gefunden — Test veraltet?" }
        assert(katalog < vergleich) {
            "Der Reiter Vergleich muss rechts von Katalog stehen (Nutzerwunsch)"
        }
    }

    private fun confirmAddBarcodeBody(): String {
        val src = code(read("ui/BarcodeFeature.kt"))
        val start = src.indexOf("fun MainViewModel.confirmAddBarcode(")
        assert(start >= 0) { "confirmAddBarcode() nicht gefunden" }
        val next = src.indexOf("fun MainViewModel.cancelBarcode(", start)
        return if (next > start) src.substring(start, next) else src.substring(start)
    }

    @Test
    fun `der Dialog schliesst SOFORT, nicht erst nach der Antwort`() {
        // ── Marcos Befund (Nachtrag 88) ─────────────────────────────────────
        // „Der Dialog scheint zu warten, bis das Set komplett importiert wurde
        // (dauert meist 5-10 Sek)."
        //
        // Genau so war es: `barcodeResult` wurde erst NACH der Antwort geleert,
        // der Dialog stand also mit gesperrtem Knopf und Kringel da, bis der
        // Server fertig war. Beim Scannen ist das die schlechteste Stelle zum
        // Warten — dort erfasst man mehrere Sets hintereinander.
        //
        // Der Galerie-Dialog schloss längst sofort; der Scanner-Dialog war der
        // Nachzügler.
        val body = confirmAddBarcodeBody()
        val schliesst = body.indexOf("result = null")
        val launch = body.indexOf("viewModelScope.launch")
        assert(schliesst >= 0) { "confirmAddBarcode() schliesst den Dialog nie" }
        assert(launch >= 0) { "confirmAddBarcode() ohne viewModelScope.launch — Test veraltet?" }
        assert(schliesst < launch) {
            "Der Dialog wird erst INNERHALB des launch geschlossen — dann steht er, " +
                "bis der Server antwortet (5-10 Sekunden)"
        }
    }

    @Test
    fun `ein Fehlschlag nennt die Setnummer`() {
        // Der Dialog ist beim Fehlschlag längst zu. Wer mehrere Sets
        // hintereinander scannt, muss wissen, WELCHES nicht durchkam —
        // „Fehler: Zeitüberschreitung" allein sagt das nicht. Dieselbe Meldung
        // wie im Galerie-Weg.
        val body = confirmAddBarcodeBody()
        assert(body.contains("meldeFehlgeschlageneErfassung(setNum")) {
            "Der Fehlerfall meldet nicht mit Setnummer"
        }
    }
}
