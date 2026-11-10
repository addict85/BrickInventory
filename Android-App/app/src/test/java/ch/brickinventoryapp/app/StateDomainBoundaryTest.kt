package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.zustand.ui.AppUiState
import ch.brickinventoryapp.zustand.ui.Sitzung
import ch.brickinventoryapp.model.ui.model.StartzustandAnsicht
import org.junit.Assert.assertEquals
import org.junit.Test
import ch.brickinventoryapp.testing.Quellen

/**
 * Wer darf welches Feld von `AppUiState` beschreiben?
 *
 * Der gemeinsame Zustand liegt in der Sitzung (zustand/ui/Sitzung.kt); geschrieben wird
 * er nur über deren benannte Schritte, ein allgemeines `aendere {}` gibt es
 * nicht mehr. Hier steht, welcher Schritt welche Felder setzt; ein neuer
 * Schreiber oder ein neues Feld fällt auf, statt still einen zweiten Weg zu öffnen.
 *
 * Der erste Test liest den Quelltext (wer hält den Zustand), der zweite führt
 * jeden Schritt aus und vergleicht die Felder davor und danach.
 *
 * Gegenproben:
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

    /** Die Felder von AppUiState, zum Vergleich vor und nach einem Schritt. */
    private val felder: Map<String, (AppUiState) -> Any?> = mapOf(
        "serverUrl" to { it.serverUrl }, "isLoggedIn" to { it.isLoggedIn }, "isAdmin" to { it.isAdmin },
        "currency" to { it.currency }, "priceCondition" to { it.priceCondition },
        "defaultPriceCondition" to { it.defaultPriceCondition }, "userDefaultCondition" to { it.userDefaultCondition },
        "appTheme" to { it.appTheme }, "startupStatus" to { it.startupStatus }, "language" to { it.language },
    )

    /** Jeder Schritt mit Werten, die sich von der Vorgabe unterscheiden. */
    private val schritte: Map<String, (Sitzung) -> Unit> = mapOf(
        "angemeldet" to { it.angemeldet(admin = true) },
        "anmeldungGeaendert" to { it.anmeldungGeaendert("https://brick.example", true) },
        "verwalterGeaendert" to { it.verwalterGeaendert(true) },
        "einstellungenGespeichert" to { it.einstellungenGespeichert("CHF", Zustand.GEBRAUCHT) },
        "einstellungenGeladen" to { it.einstellungenGeladen("CHF", Zustand.GEBRAUCHT, Zustand.GEBRAUCHT, Zustand.GEBRAUCHT) },
        "waehrungUebernommen" to { it.waehrungUebernommen("CHF") },
        "spracheGeaendert" to { it.spracheGeaendert("fr") },
        "setzeDesign" to { it.setzeDesign("noppe") },
        "serverstartGeaendert" to { it.serverstartGeaendert(StartzustandAnsicht(false, "Katalog", null, 2.0, 8)) },
    )

    @Test
    fun `jeder Schritt der Sitzung setzt nur seine Felder`() {
        assertEquals(erlaubt.keys, schritte.keys)
        val fehler = mutableListOf<String>()
        for ((name, schritt) in schritte) {
            val sitzung = Sitzung()
            val vorher = sitzung.state.value
            schritt(sitzung)
            val nachher = sitzung.state.value
            val geaendert = felder.filter { (_, f) -> f(vorher) != f(nachher) }.keys
            if (geaendert.isEmpty()) fehler += "$name ändert nichts"
            (geaendert - erlaubt.getValue(name)).forEach { fehler += "$name setzt $it" }
        }
        assert(fehler.isEmpty()) {
            "Die Sitzung schreibt an unerwarteter Stelle:\n  " + fehler.joinToString("\n  ") +
                "\nGehört das Feld einem Bereich, zieht es in dessen eigenen Zustand; sonst die Liste oben bewusst erweitern."
        }
    }
}
