package ch.brickinventoryapp.state

import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.PasswordRequired
import ch.brickinventoryapp.data.SecondFactorRequired
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.ScrollMemory
import ch.brickinventoryapp.session.Sitzung
import ch.brickinventoryapp.session.SitzungsRepository
import ch.brickinventoryapp.testing.FakeApi
import ch.brickinventoryapp.testing.TestDienste
import ch.brickinventoryapp.state.ui.AppViewModel
import ch.brickinventoryapp.state.ui.Ausgangsmelder
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
 * Der AppViewModel ausgeführt: Er reicht Sitzung, Pflichten und Meldungen an die
 * Activity durch und entscheidet zwei Dinge selbst — was im Vordergrund nachgeladen
 * wird und welches Set eine angetippte Meldung öffnen darf.
 *
 * Gegenproben (je ein Patch unter gegenproben/):
 *   app-vordergrund-ohne-sitzung   inForeground() ohne `if (!state.value.isLoggedIn) return`
 *                                  → rot „abgemeldet laedt der Vordergrund nichts nach“
 *   app-meldungsziel-ungeprueft    setFromMessageRequest() ohne setNumberFromMessage
 *                                  → rot „eine angetippte Meldung oeffnet nur eine gueltige Setnummer“
 *   app-meldung-nicht-quittiert    clearSnackbar() ruft quittiere() nicht → rot „die Snackbar …“
 */
class AppViewModelTest {

    private val t = TestDienste(FakeApi().api)

    /** Zählt, was der AppViewModel bei der Sitzung auslöst. */
    private class Sitzungsschritte : SitzungsRepository {
        val called = mutableListOf<String>()
        override fun starte() { called += "starte" }
        override fun abmelden(): Job { called += "abmelden"; return Job().apply { complete() } }
        override fun secondFactorConfigured() { called += "faktor" }
        override fun ladeEinstellungen() { called += "einstellungen" }
        override fun loadMembers() { called += "mitglieder" }
        override fun ladeLagerorte() { called += "lagerorte" }
    }

    private val schritte = Sitzungsschritte()
    private val sitzung: Sitzung = t.sitzung
    private val kanal = MeldungsKanal()
    private val passwort = PasswordRequired()
    private val faktor = SecondFactorRequired()
    private val ausgang = object : Ausgangsmelder {
        override val offene: StateFlow<Int> = MutableStateFlow(3)
        override fun starte(scope: CoroutineScope) = Unit
    }
    private val vm = AppViewModel(schritte, kanal, sitzung, t.blickfeld, ScrollMemory(), ausgang, passwort, faktor)

    @After fun zu() { t.aufraeumen() }

    @Test
    fun `abgemeldet laedt der Vordergrund nichts nach, angemeldet Einstellungen und Filterlisten`() {
        vm.inForeground()
        assertEquals(emptyList<String>(), schritte.called)
        sitzung.angemeldet(admin = false)
        vm.inForeground()
        assertEquals(listOf("einstellungen", "mitglieder", "lagerorte"), schritte.called)
    }

    @Test
    fun `eine angetippte Meldung oeffnet nur eine gueltige Setnummer, bis sie quittiert ist`() {
        vm.setFromMessageRequest("75192-1")
        assertEquals("75192-1", vm.messageTarget.value.setNummer)
        vm.setFromMessageAcknowledge()
        assertNull(vm.messageTarget.value.setNummer)
        // Die Nummer wird Teil einer Route: Was keine Setnummer ist, öffnet nichts.
        vm.setFromMessageRequest("../../konto")
        assertNull(vm.messageTarget.value.setNummer)
        vm.setFromMessageRequest(null)
        assertNull(vm.messageTarget.value.setNummer)
    }

    @Test
    fun `die Snackbar zeigt den Kanal, quittiert rueckt die naechste nach`() {
        kanal.zeige(Meldung.Resource(1))
        kanal.zeige(Meldung.Resource(2))
        assertEquals(Meldung.Resource(1), vm.snackbar.value)
        vm.clearSnackbar()
        assertEquals(Meldung.Resource(2), vm.snackbar.value)
    }

    @Test
    fun `Abmelden, zweiter Faktor und Pflichten gehen an Sitzung und Ablage durch`() {
        vm.logout()
        vm.secondFactorConfigured()
        assertEquals(listOf("abmelden", "faktor"), schritte.called)
        passwort.melde()
        faktor.melde()
        assertEquals(true, vm.startPasswordNeeded.value)
        assertEquals(true, vm.secondFactorNeeded.value)
        assertEquals(3, vm.offeneAenderungen.value)
        assertSame("dieselbe Sitzung wie die Bereiche", sitzung.state, vm.state)
    }
}
