package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.session.Sitzung
import ch.brickinventoryapp.model.domain.StartStateView
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Who may write which field of `AppUiState`? The session keeps the state private
 * and changes it only via named steps; here stands which step sets which fields,
 * so that a step does not silently open a second path to a foreign field.
 *
 * Counter-check: in waehrungUebernommen() `priceCondition` written along
 * (gegenproben/zustand-schritt-zu-breit.patch) → red “every step of the session sets only its fields“.
 */
class StateDomainBoundaryTest {

    /** Step of the session → fields it may set. */
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

    /** The fields of AppUiState, for comparison before and after a step. */
    private val felder: Map<String, (AppUiState) -> Any?> = mapOf(
        "serverUrl" to { it.serverUrl }, "isLoggedIn" to { it.isLoggedIn }, "isAdmin" to { it.isAdmin },
        "currency" to { it.currency }, "priceCondition" to { it.priceCondition },
        "defaultPriceCondition" to { it.defaultPriceCondition }, "userDefaultCondition" to { it.userDefaultCondition },
        "appTheme" to { it.appTheme }, "startupStatus" to { it.startupStatus }, "language" to { it.language },
    )

    /** Every step with values that differ from the default. */
    private val schritte: Map<String, (Sitzung) -> Unit> = mapOf(
        "angemeldet" to { it.angemeldet(admin = true) },
        "anmeldungGeaendert" to { it.anmeldungGeaendert("https://brick.example", true) },
        "verwalterGeaendert" to { it.verwalterGeaendert(true) },
        "einstellungenGespeichert" to { it.einstellungenGespeichert(Waehrung.CHF, Zustand.GEBRAUCHT) },
        "einstellungenGeladen" to { it.einstellungenGeladen(Waehrung.CHF, Zustand.GEBRAUCHT, Zustand.GEBRAUCHT, Zustand.GEBRAUCHT) },
        "waehrungUebernommen" to { it.waehrungUebernommen(Waehrung.CHF) },
        "spracheGeaendert" to { it.spracheGeaendert("fr") },
        "setzeDesign" to { it.setzeDesign(Design.NOPPE) },
        "serverstartGeaendert" to { it.serverstartGeaendert(StartStateView(false, "Katalog", null, 2.0, 8)) },
    )

    @Test
    fun `every step of the session sets only its fields`() {
        assertEquals(erlaubt.keys, schritte.keys)
        val fehler = mutableListOf<String>()
        for ((name, schritt) in schritte) {
            val sitzung = Sitzung()
            val vorher = sitzung.state.value
            schritt(sitzung)
            val after = sitzung.state.value
            val geaendert = felder.filter { (_, f) -> f(vorher) != f(after) }.keys
            if (geaendert.isEmpty()) fehler += "$name ändert nichts"
            (geaendert - erlaubt.getValue(name)).forEach { fehler += "$name setzt $it" }
        }
        assert(fehler.isEmpty()) {
            "Die Sitzung schreibt an unerwarteter Stelle:\n  " + fehler.joinToString("\n  ") +
                "\nGehört das Feld einem Bereich, zieht es in dessen eigenen Zustand; sonst die Liste oben bewusst erweitern."
        }
    }
}
