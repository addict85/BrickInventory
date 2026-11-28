package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.appearance.Design
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.StartStateView
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.session.Session
import ch.brickinventoryapp.session.testing.testSession
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Who may write which field of `AppUiState`? The session keeps the state private
 * and changes it only via named steps; here stands which step sets which fields,
 * so that a step does not silently open a second path to a foreign field.
 *
 * Counter-check: in currencyAdopted() `priceCondition` written along
 * (counter-checks/state-step-too-wide.patch) → red “every step of the session sets only its fields“.
 */
class StateDomainBoundaryTest {

    /** Step of the session → fields it may set. */
    private val allowed = mapOf(
        "angemeldet" to setOf("isLoggedIn", "isAdmin"),
        "loginChanged" to setOf("serverUrl", "isLoggedIn"),
        "adminChanged" to setOf("isAdmin"),
        "settingsSaved" to setOf("currency", "priceCondition"),
        "settingsLoaded" to setOf("currency", "priceCondition", "defaultPriceCondition", "userDefaultCondition"),
        "currencyAdopted" to setOf("currency"),
        "languageChanged" to setOf("language"),
        "setDesign" to setOf("appTheme"),
        "serverStartChanged" to setOf("startupStatus"),
    )

    /** The fields of AppUiState, for comparison before and after a step. */
    private val fields: Map<String, (AppUiState) -> Any?> = mapOf(
        "serverUrl" to { it.serverUrl }, "isLoggedIn" to { it.isLoggedIn }, "isAdmin" to { it.isAdmin },
        "currency" to { it.currency }, "priceCondition" to { it.priceCondition },
        "defaultPriceCondition" to { it.defaultPriceCondition }, "userDefaultCondition" to { it.userDefaultCondition },
        "appTheme" to { it.appTheme }, "startupStatus" to { it.startupStatus }, "language" to { it.language },
    )

    /** Every step with values that differ from the default. */
    private val steps: Map<String, (Session) -> Unit> = mapOf(
        "angemeldet" to { it.loggedIn(admin = true) },
        "loginChanged" to { it.loginChanged("https://brick.example", true) },
        "adminChanged" to { it.adminChanged(true) },
        "settingsSaved" to { it.settingsSaved(CurrencyCode.CHF, Condition.USED) },
        "settingsLoaded" to { it.settingsLoaded(CurrencyCode.CHF, Condition.USED, Condition.USED, Condition.USED) },
        "currencyAdopted" to { it.currencyAdopted(CurrencyCode.CHF) },
        "languageChanged" to { it.languageChanged("fr") },
        "setDesign" to { it.setDesign(Design.STUD) },
        "serverStartChanged" to { it.serverStartChanged(StartStateView(false, "Katalog", null, 2.0, 8)) },
    )

    @Test
    fun `every step of the session sets only its fields`() {
        assertEquals(allowed.keys, steps.keys)
        val error = mutableListOf<String>()
        for ((name, step) in steps) {
            val session = testSession()
            val before = session.state.value
            step(session)
            val after = session.state.value
            val changed = fields.filter { (_, f) -> f(before) != f(after) }.keys
            if (changed.isEmpty()) error += "$name ändert nichts"
            (changed - allowed.getValue(name)).forEach { error += "$name setzt $it" }
        }
        assert(error.isEmpty()) {
            "The session writes at an unexpected place:\n  " + error.joinToString("\n  ") +
                "\nIf the field belongs to an area, it moves into that area's own state; otherwise extend the list above deliberately."
        }
    }
}
