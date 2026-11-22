package ch.brickinventoryapp.state

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.AppearanceStore
import ch.brickinventoryapp.data.TrustStore
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.security.CertificateQuestion
import ch.brickinventoryapp.security.CertificateUnresolved
import ch.brickinventoryapp.session.Session
import ch.brickinventoryapp.session.StoreAccountValues
import ch.brickinventoryapp.state.ui.viewmodel.AppearanceViewModel
import ch.brickinventoryapp.state.ui.viewmodel.TrustViewModel
import ch.brickinventoryapp.testing.StorageSessionStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * AppearanceViewModel and TrustViewModel put to the test, with in-memory stores
 * instead of PreferencesManager and in virtual time.
 *
 * Counter-checks:
 *   design-spaet-gesetzt        StoreAccountValues starts with the default instead of the remembered theme → red „der Zustand wird mit …“
 *   widget-nicht-angestossen    `widget.refresh()` removed → red „eine Wahl wird gemerkt …“
 *   vertrauen-ohne-abwurf       after trustCertificate() no `drop.discard()` → red „ein bestätigter …“
 *   unbekannte-ca-ohne-abtippen in CertificateQuestion.bestaetige() the typing-in requirement removed → red „ohne bekannte CA …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RenderingAndTrustTest {

    private val tick = StandardTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(tick)

    @After fun ab() = Dispatchers.resetMain()

    private class StorageRendering : AppearanceStore {
        var design = Design.CLASSIC
        var light = "system"
        var colors = false
        var hide = true
        var widget = false
        var language = ""
        override fun rememberedDesign() = design
        override fun brightness() = light
        override fun applyBrightness(choice: String) { light = choice }
        override fun systemColors() = colors
        override fun applySystemColors(an: Boolean) { colors = an }
        override fun hidePreview() = hide
        override fun applyPreviewHidden(an: Boolean) { hide = an }
        override fun showWidgetValues() = widget
        override fun showSetWidgetValues(an: Boolean) { widget = an }
        override suspend fun saveLanguage(lang: String) { language = lang }
    }

    private class StorageTrust : TrustStore {
        val pins = mutableMapOf<String, String>()
        var caOn = false
        override fun pin(key: String) = pins[key]
        override fun rememberPin(key: String, fingerprint: String) { pins[key] = fingerprint }
        override fun userCaAllowed() = caOn
        override fun setUserCa(an: Boolean) { caOn = an }
    }

    @Test
    fun `the state is born with the remembered design`() = runTest(tick) {
        val store = StorageRendering().apply { design = Design.STUD }
        val account = StorageSessionStore().apply { design.value = Design.STUD }
        // As on the device: currency and theme from the store, the first from the synchronous mirror.
        val session = Session(StoreAccountValues(account, store, backgroundScope))
        val vm = AppearanceViewModel(store, session) {}
        // Without a single tick of the clock: the first frame already shows the remembered theme.
        assertEquals(Design.STUD, vm.appTheme.value)
        assertEquals(Design.STUD, session.state.value.appTheme)
        vm.viewModelScope.cancel()
    }

    @Test
    fun `a choice is remembered and applies immediately, the widget learns of its values`() = runTest(tick) {
        val store = StorageRendering()
        var widgetKicks = 0
        val vm = AppearanceViewModel(store, Session()) { widgetKicks++ }
        assertTrue("Vorgabe: Vorschau verborgen", vm.hidePreview.value)

        vm.setBrightness("dunkel")
        vm.setSystemColors(true)
        vm.setPreviewHidden(false)
        assertEquals("dunkel", store.light)
        assertEquals("dunkel", vm.brightness.value)
        assertTrue(store.colors && vm.systemColors.value)
        assertFalse(store.hide || vm.hidePreview.value)
        assertEquals("Andere Werte stossen das Widget nicht an", 0, widgetKicks)

        vm.setWidgetValues(true)
        advanceUntilIdle()
        assertTrue(store.widget && vm.widgetValues.value)
        assertEquals("Das Widget zeigt die neue Wahl erst nach einem Anstoss", 1, widgetKicks)
        vm.viewModelScope.cancel()
    }

    @Test
    fun `a confirmed first contact remembers the pin and discards the open connections`() {
        val question = CertificateQuestion()
        val store = StorageTrust()
        var drops = 0
        val vm = TrustViewModel(store, { drops++ }, question)
        question.report(CertificateUnresolved("brick.example:443", "AB:CD", CertificateUnresolved.Kind.FIRST_CONTACT, ctForced = true))
        assertEquals("AB:CD", vm.certificate.value?.fingerprint)

        assertTrue(vm.trustCertificate())
        assertEquals("AB:CD", store.pins["brick.example:443"])
        assertEquals("Verbindungen mit dem alten Vertrauen bleiben offen", 1, drops)
        assertNull(vm.certificate.value)
        assertFalse("Ohne offene Frage nichts zu bestätigen", vm.trustCertificate())
        assertEquals(1, drops)
    }

    @Test
    fun `without a known CA only the typed fingerprint counts, discarding remembers nothing`() {
        val question = CertificateQuestion()
        val store = StorageTrust()
        var drops = 0
        val vm = TrustViewModel(store, { drops++ }, question)
        val fp = "0123456789ABCDEF0123456789ABCDEF"
        question.report(CertificateUnresolved("brick.example:443", fp, CertificateUnresolved.Kind.UNKNOWN_CA))

        assertFalse("Ein Tipp allein genügt nicht", vm.trustCertificate())
        assertFalse("Ein falscher Fingerabdruck genügt nicht", vm.trustCertificate("FFFFFFFFFFFF"))
        assertTrue(store.pins.isEmpty())
        assertEquals(0, drops)
        assertTrue(vm.trustCertificate(fp))
        assertEquals(fp, store.pins["brick.example:443"])
        assertEquals(1, drops)

        question.report(CertificateUnresolved("andere.example:443", "EE", CertificateUnresolved.Kind.FIRST_CONTACT))
        vm.discardCertificate()
        assertNull(vm.certificate.value)
        assertNull(store.pins["andere.example:443"])
    }

    @Test
    fun `user CAs only after confirmation, every change discards the connections`() {
        val store = StorageTrust()
        var drops = 0
        val vm = TrustViewModel(store, { drops++ }, CertificateQuestion())
        vm.userCa.requests()
        assertTrue(vm.userCa.question.value)
        assertFalse("Erst die Bestätigung schaltet ein", store.caOn)
        vm.userCa.confirm()
        assertTrue(store.caOn && vm.userCa.an.value)
        assertEquals(1, drops)
        vm.userCa.turnOff()
        assertFalse(store.caOn)
        assertEquals(2, drops)
    }
}
