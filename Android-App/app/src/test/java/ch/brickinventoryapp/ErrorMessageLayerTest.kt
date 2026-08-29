package ch.brickinventoryapp

import org.junit.Test

/**
 * Fehlermeldungen entstehen an EINER Stelle, und die kann übersetzen.
 *
 * ── Woher dieser Test kommt (Nachtrag 116) ──────────────────────────────────
 *
 * `BrickRepository.safeCall()` formulierte seine Meldungen selbst:
 * „Netzwerkfehler", „Zeitüberschreitung", „Leere Antwort vom Server". Deutsche
 * Sätze in einer Schicht, die keinen Context hat und also gar nicht übersetzen
 * KANN. Für einen englischsprachigen Nutzer war damit jede Fehlermeldung der
 * App deutsch, egal wie sauber der Bildschirm darüber lokalisiert war —
 * dieselbe Ursache wie beim PDF-Betrachter in Nachtrag 115, nur an der Stelle,
 * die alle Fehler formuliert.
 *
 * Von 36 Snackbar-Zuweisungen liefen damals 19 über `getString`; der Rest
 * reichte durch, was aus der Datenschicht kam. Es waren also zwei Sprachregime
 * nebeneinander, und welches griff, hing davon ab, wo der Fehler entstand.
 *
 * Jetzt meldet die Datenschicht nur noch die URSACHE als [Fehlerart]; den Satz
 * formuliert `MainViewModel.meldung()`. Dieser Test hält beide Hälften fest.
 */
class ErrorMessageLayerTest {

    private val datenschicht = listOf(
        // Alle Dateien der Datenschicht (Nachtrag 155) — vorher nur die eine.
        "data/repository/BrickRepository.kt",
        "data/repository/RepoBasis.kt",
        "data/repository/SetsRepository.kt",
        "data/repository/TeileRepository.kt",
        "data/repository/FinanzenRepository.kt",
        "data/repository/HaushaltRepository.kt",
        "data/repository/AdminRepository.kt",
        "data/CsvImportSseClient.kt",
    )

    @Test
    fun `die Datenschicht baut keine Meldung fuer den Nutzer`() {
        // Gesucht: Result.Error("irgendein Satz"). Erlaubt ist nur der leere
        // Text — dann entscheidet die Anzeige — oder eine durchgereichte
        // Servermeldung (eine Variable, keine Zeichenkette).
        val fehler = mutableListOf<String>()
        for (rel in datenschicht) {
            val s = Quellen.ohneKommentare(Quellen.lies(rel))
            Regex("""Result\.Error\(\s*"([^"]+)"""").findAll(s).forEach { m ->
                val zeile = s.substring(0, m.range.first).count { it == '\n' } + 1
                fehler += "$rel:$zeile  Result.Error(\"${m.groupValues[1]}\")"
            }
        }
        assert(fehler.isEmpty()) {
            "Die Datenschicht formuliert wieder selbst. Sie hat keinen Context und " +
                "kann nicht übersetzen — stattdessen eine Fehlerart melden und den " +
                "Satz in MainViewModel.meldung() bilden:\n  " + fehler.joinToString("\n  ")
        }
    }

    @Test
    fun `die Zuordnung Ursache zu Text liegt ausserhalb von meldung`() {
        // Ob jede Fehlerart einen eigenen Satz hat, prüft seit Nachtrag 117
        // FehlerTexteTest — ausgeführt statt gelesen. Hier bleibt nur die
        // Aussage, die eine Textsuche wirklich treffen kann: dass die
        // Zuordnung eine eigene, Context-freie Funktion IST. Wandert sie
        // zurück in meldung(), ist sie wieder nur über Android prüfbar.
        val texte = Quellen.ohneKommentare(Quellen.lies("ui/FehlerTexte.kt"))
        assert(texte.contains("fun fehlerTextId(")) { "fehlerTextId() fehlt" }
        assert(!texte.contains("ctx.") && !texte.contains("Context")) {
            "FehlerTexte.kt darf keinen Context brauchen — sonst ist die Zuordnung " +
                "wieder nur mit Android-Laufzeit prüfbar"
        }
        val vm = Quellen.ohneKommentare(Quellen.lies("ui/MainViewModel.kt"))
        val meldung = Quellen.funktion(vm, "internal fun meldung(")
        assert(meldung.isNotEmpty()) { "meldung() fehlt im MainViewModel" }
        assert(meldung.contains("fehlerTextId(")) {
            "meldung() benutzt die gemeinsame Zuordnung nicht mehr"
        }
    }

    @Test
    fun `die Servermeldung hat Vorrang`() {
        // Der Server kennt seine Fälle genauer als jede Aufzählung hier
        // (Kaufdatum-Konflikt, Währung passt nicht, Code schon eingelöst) und
        // antwortet in der Sprache des Kontos. Ginge dieser Vorrang verloren,
        // bekäme der Nutzer statt „Für dieses Datum gibt es schon einen
        // Kaufpreis" nur noch „Serverfehler (409)".
        val vm = Quellen.ohneKommentare(Quellen.lies("ui/MainViewModel.kt"))
        val meldung = Quellen.funktion(vm, "internal fun meldung(")
        assert(meldung.contains("fehler.message.isNotBlank()")) {
            "meldung() prüft die Servermeldung nicht mehr zuerst"
        }
        val vorrang = meldung.indexOf("fehler.message.isNotBlank()")
        // Anker auf fehlerTextId(): Bis Nachtrag 116 stand hier ein `when
        // (fehler.art)` direkt in meldung(). Seit die Zuordnung ausgelagert
        // ist, wäre der alte Anker nie mehr zu finden gewesen — und ein Test,
        // der ins Leere greift, ist grün, ohne etwas zu prüfen.
        val eigene = meldung.indexOf("fehlerTextId(")
        assert(vorrang in 0 until eigene) {
            "Die eigene Formulierung läuft VOR der Servermeldung — dann ist die " +
                "genauere Meldung des Servers nie zu sehen"
        }
    }
}
