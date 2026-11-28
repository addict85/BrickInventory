package ch.brickinventoryapp.state

import ch.brickinventoryapp.model.appearance.Design
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.session.testing.InMemoryAccountValues
import ch.brickinventoryapp.session.testing.testSession
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Currency and theme have one source, the store: the session follows it without a
 * copy of its own, and its own steps apply before the call returns.
 *
 * Counter-check: `.launchIn(scope)` in the init of SessionState removed → red "currency and theme from the store reach the session" (EUR instead of CHF).
 */
class SessionStateTest {

    private val values = InMemoryAccountValues()
    private val session = testSession(values)

    @Test
    fun `currency and theme from the store reach the session, sign-out keeps the theme`() {
        values.setCurrency(CurrencyCode("CHF"))
        values.setDesign(Design.STUD)
        assertEquals(CurrencyCode("CHF"), session.state.value.currency)
        assertEquals(Design.STUD, session.state.value.appTheme)

        session.loggedOut()
        assertEquals(AppUiState().currency, session.state.value.currency)
        assertEquals(Design.STUD, session.state.value.appTheme)
    }

    @Test
    fun `the session's own steps apply before the call returns`() {
        session.loggedIn(admin = true)
        assertTrue(session.state.value.isLoggedIn && session.state.value.isAdmin)
    }
}
