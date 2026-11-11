package ch.brickinventoryapp.zustand

import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.PasswortPflicht
import ch.brickinventoryapp.data.ZweiterFaktorPflicht
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.ScrollMemory
import ch.brickinventoryapp.sitzung.Sitzung
import ch.brickinventoryapp.sitzung.SitzungsRepository
import ch.brickinventoryapp.testing.FakeApi
import ch.brickinventoryapp.testing.TestDienste
import ch.brickinventoryapp.zustand.ui.AppViewModel
import ch.brickinventoryapp.zustand.ui.Ausgangsmelder
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
 *   app-vordergrund-ohne-sitzung   imVordergrund() ohne `if (!state.value.isLoggedIn) return`
 *                                  → rot „abgemeldet laedt der Vordergrund nichts nach“
 *   app-meldungsziel-ungeprueft    setAusMeldungAnfordern() ohne setnummerAusMeldung
 *                                  → rot „eine angetippte Meldung oeffnet nur eine gueltige Setnummer“
 *   app-meldung-nicht-quittiert    clearSnackbar() ruft quittiere() nicht → rot „die Snackbar …“
 */
class AppViewModelTest {

    private val t = TestDienste(FakeApi().api)

    /** Zählt, was der AppViewModel bei der Sitzung auslöst. */
    private class Sitzungsschritte : SitzungsRepository {
        val gerufen = mutableListOf<String>()
        override fun starte() { gerufen += "starte" }
        override fun abmelden(): Job { gerufen += "abmelden"; return Job().apply { complete() } }
        override fun zweiterFaktorEingerichtet() { gerufen += "faktor" }
        override fun ladeEinstellungen() { gerufen += "einstellungen" }
        override fun ladeMitglieder() { gerufen += "mitglieder" }
        override fun ladeLagerorte() { gerufen += "lagerorte" }
    }

    private val schritte = Sitzungsschritte()
    private val sitzung: Sitzung = t.sitzung
    private val kanal = MeldungsKanal()
    private val passwort = PasswortPflicht()
    private val faktor = ZweiterFaktorPflicht()
    private val ausgang = object : Ausgangsmelder {
        override val offene: StateFlow<Int> = MutableStateFlow(3)
        override fun starte(scope: CoroutineScope) = Unit
    }
    private val vm = AppViewModel(schritte, kanal, sitzung, t.blickfeld, ScrollMemory(), ausgang, passwort, faktor)

    @After fun zu() { t.aufraeumen() }

    @Test
    fun `abgemeldet laedt der Vordergrund nichts nach, angemeldet Einstellungen und Filterlisten`() {
        vm.imVordergrund()
        assertEquals(emptyList<String>(), schritte.gerufen)
        sitzung.angemeldet(admin = false)
        vm.imVordergrund()
        assertEquals(listOf("einstellungen", "mitglieder", "lagerorte"), schritte.gerufen)
    }

    @Test
    fun `eine angetippte Meldung oeffnet nur eine gueltige Setnummer, bis sie quittiert ist`() {
        vm.setAusMeldungAnfordern("75192-1")
        assertEquals("75192-1", vm.meldungsZiel.value.setNummer)
        vm.setAusMeldungQuittieren()
        assertNull(vm.meldungsZiel.value.setNummer)
        // Die Nummer wird Teil einer Route: Was keine Setnummer ist, öffnet nichts.
        vm.setAusMeldungAnfordern("../../konto")
        assertNull(vm.meldungsZiel.value.setNummer)
        vm.setAusMeldungAnfordern(null)
        assertNull(vm.meldungsZiel.value.setNummer)
    }

    @Test
    fun `die Snackbar zeigt den Kanal, quittiert rueckt die naechste nach`() {
        kanal.zeige(Meldung.Ressource(1))
        kanal.zeige(Meldung.Ressource(2))
        assertEquals(Meldung.Ressource(1), vm.snackbar.value)
        vm.clearSnackbar()
        assertEquals(Meldung.Ressource(2), vm.snackbar.value)
    }

    @Test
    fun `Abmelden, zweiter Faktor und Pflichten gehen an Sitzung und Ablage durch`() {
        vm.logout()
        vm.zweiterFaktorEingerichtet()
        assertEquals(listOf("abmelden", "faktor"), schritte.gerufen)
        passwort.melde()
        faktor.melde()
        assertEquals(true, vm.startpasswortNoetig.value)
        assertEquals(true, vm.zweiterFaktorNoetig.value)
        assertEquals(3, vm.offeneAenderungen.value)
        assertSame("dieselbe Sitzung wie die Bereiche", sitzung.state, vm.state)
    }
}
