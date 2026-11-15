package ch.brickinventoryapp.ui

import ch.brickinventoryapp.ui.components.AppSperre
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Die App-Sperre: neu installiert mit Displaysperre an, sonst aus; an, sperrt sie erst nach
 * Ablauf der Minuten im Hintergrund, und eine neue Activity (Drehen, Prozessende) entsperrt
 * nicht von selbst.
 *
 * Gegenproben (09.11.2026 lokal mit kotlinc gemessen):
 *   A  in imVordergrund() jede Rückkehr gesperrt (`jetzt - seit >= 0`) → rot „vor Ablauf
 *      der Frist fragt die App nicht“; gegenproben/app-sperre-sofort.patch
 *   B  der Zustand nur im Speicher (`MutableStateFlow(false)`) → rot „eine neue Activity
 *      entsperrt nicht“; gegenproben/app-sperre-vergisst-beim-drehen.patch
 *   C  in imVordergrund() der Vergleich des Gerätestarts gestrichen (`neugestartet = false`)
 *      → rot „nach einem Neustart gesperrt, auch wenn die Uhr schon weiter ist“;
 *      gegenproben/app-sperre-ohne-geraetestart.patch
 *   D  (kotlinc) verdecktWidget() nur `ablage.gesperrt()` → rot „das Widget
 *      verdeckt seine Betraege, sobald die Sperre greifen kann“; gegenproben/widget-trotz-sperre.patch
 *   E  (kotlinc) vorgabe() immer 0 → rot „neu installiert mit Displaysperre …“;
 *      gegenproben/app-sperre-vorgabe-aus.patch
 */
class AppSperreTest {

    private class Speicher : AppSperre.Ablage {
        var minuten = 0
        var seit: Long? = null
        var start: Int? = null
        var gesperrt = false
        override fun minuten() = minuten
        override fun setzeMinuten(minuten: Int) { this.minuten = minuten }
        override fun hintergrundSeit() = seit
        override fun merkeHintergrund(seit: Long?) { this.seit = seit }
        override fun hintergrundStart() = start
        override fun merkeHintergrundStart(start: Int?) { this.start = start }
        override fun gesperrt() = gesperrt
        override fun setzeGesperrt(an: Boolean) { gesperrt = an }
    }

    private var jetzt = 1_000_000L
    private var starts: Int? = 7
    private val ablage = Speicher()
    private fun sperre() = AppSperre({ jetzt }, ablage) { starts }

    private fun AppSperre.weg(ms: Long) {
        imHintergrund()
        jetzt += ms
        imVordergrund()
    }

    @Test
    fun `standardmaessig aus`() {
        val s = sperre()
        s.weg(24 * 60 * AppSperre.MINUTE_MS)
        assertFalse(s.gesperrt.value)
    }

    @Test
    fun `vor Ablauf der Frist fragt die App nicht`() {
        val s = sperre().apply { setzeMinuten(5) }
        s.weg(5 * AppSperre.MINUTE_MS - 1)
        assertFalse(s.gesperrt.value)
        s.weg(1_000)
        assertFalse("Jede Rückkehr beginnt die Frist neu", s.gesperrt.value)
    }

    @Test
    fun `nach Ablauf gesperrt, bis entsperrt`() {
        val s = sperre().apply { setzeMinuten(1) }
        s.weg(AppSperre.MINUTE_MS)
        assertTrue(s.gesperrt.value)
        s.weg(1_000)
        assertTrue("Kurz weg und zurück entsperrt nicht", s.gesperrt.value)
        s.entsperrt()
        assertFalse(s.gesperrt.value)
    }

    @Test
    fun `eine neue Activity entsperrt nicht`() {
        sperre().apply { setzeMinuten(15) }.weg(16 * AppSperre.MINUTE_MS)
        val neu = sperre()
        neu.imVordergrund()
        assertTrue(neu.gesperrt.value)
    }

    @Test
    fun `nach einem Neustart des Geraets gesperrt`() {
        val s = sperre().apply { setzeMinuten(30) }
        s.imHintergrund()
        jetzt = 5_000L
        s.imVordergrund()
        assertTrue(s.gesperrt.value)
    }

    @Test
    fun `nach einem Neustart gesperrt, auch wenn die Uhr schon weiter ist`() {
        val s = sperre().apply { setzeMinuten(30) }
        s.imHintergrund()
        starts = 8
        jetzt += AppSperre.MINUTE_MS
        s.imVordergrund()
        assertTrue("Ein neuer Gerätestart sperrt, auch vor Ablauf der Frist", s.gesperrt.value)
    }

    @Test
    fun `ein unlesbarer Startzaehler sperrt, ein gleicher nicht`() {
        val s = sperre().apply { setzeMinuten(30) }
        s.weg(AppSperre.MINUTE_MS)
        assertFalse("Derselbe Start und kurz weg: keine Rückfrage", s.gesperrt.value)
        s.imHintergrund()
        starts = null
        jetzt += AppSperre.MINUTE_MS
        s.imVordergrund()
        assertTrue("Ist der Zähler nicht mehr lesbar, ist ein Neustart nicht ausgeschlossen", s.gesperrt.value)
    }

    @Test
    fun `das Widget verdeckt seine Betraege, sobald die Sperre greifen kann`() {
        val s = sperre()
        s.imHintergrund()
        assertFalse("Ohne Sperre zeigt es sie", AppSperre.verdecktWidget(ablage))
        s.imVordergrund()
        s.setzeMinuten(15)
        assertFalse("Im Vordergrund und entsperrt", AppSperre.verdecktWidget(ablage))
        s.imHintergrund()
        assertTrue("Im Hintergrund, auch vor Ablauf der Frist", AppSperre.verdecktWidget(ablage))
        jetzt += 15 * AppSperre.MINUTE_MS
        s.imVordergrund()
        assertTrue(s.gesperrt.value)
        assertTrue("Gesperrt im Vordergrund", AppSperre.verdecktWidget(ablage))
        s.entsperrt()
        assertFalse(AppSperre.verdecktWidget(ablage))
    }

    @Test
    fun `neu installiert mit Displaysperre ist die Sperre an, sonst bleibt sie aus`() {
        assertTrue(AppSperre.VORGABE_MINUTEN in AppSperre.WAHL && AppSperre.VORGABE_MINUTEN > 0)
        assertEquals(AppSperre.VORGABE_MINUTEN, AppSperre.vorgabe(neuInstalliert = true, geraetGesichert = true))
        assertEquals("Ohne Displaysperre liesse sich nicht entsperren", 0, AppSperre.vorgabe(neuInstalliert = true, geraetGesichert = false))
        assertEquals("Ein Update stellt nichts um", 0, AppSperre.vorgabe(neuInstalliert = false, geraetGesichert = true))
    }
}
