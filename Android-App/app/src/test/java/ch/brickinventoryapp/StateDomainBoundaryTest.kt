package ch.brickinventoryapp

import org.junit.Test

/**
 * Wer darf welches Feld von `AppUiState` beschreiben?
 *
 * Der gemeinsame Zustand liegt in der Sitzung (ui/Sitzung.kt); geschrieben wird
 * er nur über deren benannte Schritte, ein allgemeines `aendere {}` gibt es
 * nicht mehr. Hier steht, welcher Schritt welche Felder setzt; ein neuer
 * Schreiber oder ein neues Feld fällt auf, statt still einen zweiten Weg zu öffnen.
 *
 * Gegenproben (05.11.2026, gemessen mit kotlinc lokal):
 *   A  in GalerieViewModel `MutableStateFlow(AppUiState())` ergänzt → rot
 *      „nur die Sitzung hält den gemeinsamen Zustand“
 *   B  in waehrungUebernommen() `priceCondition` mitgeschrieben → rot
 *      „jeder Schritt der Sitzung setzt nur seine Felder“
 */
class StateDomainBoundaryTest {

    /** Schritt der Sitzung → Felder, die er setzen darf. */
    private val erlaubt = mapOf(
        "angemeldet" to setOf("isLoggedIn", "isAdmin"),
        "anmeldungGeaendert" to setOf("serverUrl", "isLoggedIn"),
        "verwalterGeaendert" to setOf("isAdmin"),
        "einstellungenGespeichert" to setOf("currency", "priceCondition"),
        "einstellungenGeladen" to setOf("currency", "priceCondition", "defaultPriceCondition", "userDefaultCondition"),
        "waehrungUebernommen" to setOf("currency"),
        "spracheGeaendert" to setOf("language"),
        "setzeDesign" to setOf("appTheme"),
        "serverstartGeaendert" to setOf("startupStatus"),
    )

    @Test
    fun `nur die Sitzung haelt den gemeinsamen Zustand`() {
        val halter = Quellen.alle().filter {
            Regex("""MutableStateFlow\(\s*AppUiState\(|MutableStateFlow<AppUiState>""")
                .containsMatchIn(Quellen.ohneKommentare(it.readText()))
        }.map { it.name }
        assert(halter == listOf("Sitzung.kt")) { "Den gemeinsamen Zustand halten: $halter" }
        val sitzung = Quellen.alle().single { it.name == "Sitzung.kt" }.readText()
        assert(!Regex("""\bfun (Sitzung\.)?aendere\b""").containsMatchIn(sitzung)) {
            "Ein allgemeines aendere{} an der Sitzung öffnet jeden Weg"
        }
    }

    @Test
    fun `jeder Schritt der Sitzung setzt nur seine Felder`() {
        val src = Quellen.ohneKommentare(Quellen.alle().single { it.name == "Sitzung.kt" }.readText())
        val schritt = Regex("""override fun (\w+)\([^)]*\)\s*=\s*_state\.update\s*\{\s*it\.copy\(""")
        val fehler = mutableListOf<String>()
        val gesehen = mutableSetOf<String>()
        for (m in schritt.findAll(src)) {
            val name = m.groupValues[1]
            gesehen += name
            var i = m.range.last + 1
            var tiefe = 1
            while (i < src.length && tiefe > 0) {
                if (src[i] == '(') tiefe++ else if (src[i] == ')') tiefe--
                i++
            }
            val felder = Regex("""(\w+)\s*=""").findAll(src.substring(m.range.last + 1, i - 1)).map { it.groupValues[1] }
            val frei = erlaubt[name]
            if (frei == null) fehler += "$name: neuer Schritt" else felder.filter { it !in frei }.forEach { fehler += "$name setzt $it" }
        }
        assert(gesehen.size >= erlaubt.size - 1) { "Nur ${gesehen.size} Schritte gefunden — Muster veraltet?" }
        assert(fehler.isEmpty()) {
            "Die Sitzung schreibt an unerwarteter Stelle:\n  " + fehler.joinToString("\n  ") +
                "\nGehört das Feld einem Bereich, zieht es in dessen eigenen Zustand; sonst die Liste oben bewusst erweitern."
        }
    }
}
