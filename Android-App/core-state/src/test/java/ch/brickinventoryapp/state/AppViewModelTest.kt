package ch.brickinventoryapp.state

import ch.brickinventoryapp.data.MessageChannel
import ch.brickinventoryapp.data.PasswordRequired
import ch.brickinventoryapp.data.SecondFactorRequired
import ch.brickinventoryapp.data.testing.FakeApi
import ch.brickinventoryapp.model.ui.Message
import ch.brickinventoryapp.model.ui.ScrollMemory
import ch.brickinventoryapp.session.Session
import ch.brickinventoryapp.session.SessionRepository
import ch.brickinventoryapp.state.testing.TestServices
import ch.brickinventoryapp.state.ui.AppViewModel
import ch.brickinventoryapp.state.ui.OutboxNotifier
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

/**
 * The AppViewModel put to the test: it passes session, mandatory screens and notifications on to the
 * activity and decides two things itself — what gets reloaded in the foreground
 * and which set a tapped notification may open.
 *
 * Counter-checks (one patch each under counter-checks/):
 *   app-vordergrund-ohne-sitzung   inForeground() without `if (!state.value.isLoggedIn) return`
 *                                  → red „abgemeldet laedt der Vordergrund nichts nach“
 *   app-meldungsziel-ungeprueft    setFromMessageRequest() without setNumberFromMessage
 *                                  → red „eine angetippte Meldung oeffnet nur eine gueltige Setnummer“
 *   app-meldung-nicht-quittiert    clearSnackbar() doesn't call quittiere() → red „die Snackbar …“
 */
class AppViewModelTest {

    private val t = TestServices(FakeApi().api)

    /** Counts what the AppViewModel triggers on the session. */
    private class SessionSteps : SessionRepository {
        val called = mutableListOf<String>()
        override fun launch() { called += "starte" }
        override fun logout(): Job { called += "abmelden"; return Job().apply { complete() } }
        override fun secondFactorConfigured() { called += "faktor" }
        override fun loadSettings() { called += "einstellungen" }
        override fun loadMembers() { called += "mitglieder" }
        override fun fetchStorageLocations() { called += "lagerorte" }
    }

    private val steps = SessionSteps()
    private val session: Session = t.session
    private val channel = MessageChannel()
    private val password = PasswordRequired()
    private val factor = SecondFactorRequired()
    private val outbox = object : OutboxNotifier {
        override val pending: StateFlow<Int> = MutableStateFlow(3)
        override fun launch(scope: CoroutineScope) = Unit
    }
    private val vm = AppViewModel(steps, channel, session, t.viewport, ScrollMemory(), outbox, password, factor)

    @After fun tearDown() { t.cleanUp() }

    @Test
    fun `signed out the foreground reloads nothing, signed in settings and filter lists`() {
        vm.inForeground()
        assertEquals(emptyList<String>(), steps.called)
        session.loggedIn(admin = false)
        vm.inForeground()
        assertEquals(listOf("einstellungen", "mitglieder", "lagerorte"), steps.called)
    }

    @Test
    fun `a tapped notification opens only a valid set number until it is acknowledged`() {
        vm.setFromMessageRequest("75192-1")
        assertEquals("75192-1", vm.messageTarget.value.setNumber)
        vm.setFromMessageAcknowledge()
        assertNull(vm.messageTarget.value.setNumber)
        // The number becomes part of a route: whatever is not a set number opens nothing.
        vm.setFromMessageRequest("../../konto")
        assertNull(vm.messageTarget.value.setNumber)
        vm.setFromMessageRequest(null)
        assertNull(vm.messageTarget.value.setNumber)
    }

    @Test
    fun `the snackbar shows the channel, acknowledged the next one moves up`() {
        channel.show(Message.Resource(1))
        channel.show(Message.Resource(2))
        assertEquals(Message.Resource(1), vm.snackbar.value)
        vm.clearSnackbar()
        assertEquals(Message.Resource(2), vm.snackbar.value)
    }

    @Test
    fun `sign-out, second factor and obligations go through to session and store`() {
        vm.logout()
        vm.secondFactorConfigured()
        assertEquals(listOf("abmelden", "faktor"), steps.called)
        password.report()
        factor.report()
        assertEquals(true, vm.startPasswordNeeded.value)
        assertEquals(true, vm.secondFactorNeeded.value)
        assertEquals(3, vm.pendingChanges.value)
        assertSame("the same session as the areas", session.state, vm.state)
    }
}
