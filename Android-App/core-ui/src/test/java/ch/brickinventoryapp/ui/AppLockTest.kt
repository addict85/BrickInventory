package ch.brickinventoryapp.ui

import ch.brickinventoryapp.ui.components.AppLock
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
 *   A  in inForeground() jede Rückkehr gesperrt (`jetzt - seit >= 0`) → rot „vor Ablauf
 *      der Frist fragt die App nicht“; gegenproben/app-sperre-sofort.patch
 *   B  der Zustand nur im Speicher (`MutableStateFlow(false)`) → rot „eine neue Activity
 *      entsperrt nicht“; gegenproben/app-sperre-vergisst-beim-drehen.patch
 *   C  in inForeground() der Vergleich des Gerätestarts gestrichen (`restarted = false`)
 *      → rot „locked after a reboot, even if the clock is already further“;
 *      gegenproben/app-sperre-ohne-geraetestart.patch
 *   D  (kotlinc) hiddenWidget() nur `ablage.gesperrt()` → rot „das Widget
 *      verdeckt seine Betraege, sobald die Sperre greifen kann“; gegenproben/widget-trotz-sperre.patch
 *   E  (kotlinc) vorgabe() immer 0 → rot „neu installiert mit Displaysperre …“;
 *      gegenproben/app-sperre-vorgabe-aus.patch
 */
class AppLockTest {

    private class Speicher : AppLock.Ablage {
        var minuten = 0
        var seit: Long? = null
        var start: Int? = null
        var gesperrt = false
        override fun minuten() = minuten
        override fun setMinutes(minuten: Int) { this.minuten = minuten }
        override fun backgroundSince() = seit
        override fun rememberBackground(seit: Long?) { this.seit = seit }
        override fun backgroundStart() = start
        override fun rememberBackgroundStart(start: Int?) { this.start = start }
        override fun gesperrt() = gesperrt
        override fun setLocked(an: Boolean) { gesperrt = an }
    }

    private var jetzt = 1_000_000L
    private var starts: Int? = 7
    private val ablage = Speicher()
    private fun lock() = AppLock({ jetzt }, ablage) { starts }

    private fun AppLock.weg(ms: Long) {
        inBackground()
        jetzt += ms
        inForeground()
    }

    @Test
    fun `off by default`() {
        val s = lock()
        s.weg(24 * 60 * AppLock.MINUTE_MS)
        assertFalse(s.gesperrt.value)
    }

    @Test
    fun `before the deadline expires the app does not ask`() {
        val s = lock().apply { setMinutes(5) }
        s.weg(5 * AppLock.MINUTE_MS - 1)
        assertFalse(s.gesperrt.value)
        s.weg(1_000)
        assertFalse("Jede Rückkehr beginnt die Frist neu", s.gesperrt.value)
    }

    @Test
    fun `after expiry locked until unlocked`() {
        val s = lock().apply { setMinutes(1) }
        s.weg(AppLock.MINUTE_MS)
        assertTrue(s.gesperrt.value)
        s.weg(1_000)
        assertTrue("Kurz weg und zurück entsperrt nicht", s.gesperrt.value)
        s.entsperrt()
        assertFalse(s.gesperrt.value)
    }

    @Test
    fun `a new activity does not unlock`() {
        lock().apply { setMinutes(15) }.weg(16 * AppLock.MINUTE_MS)
        val neu = lock()
        neu.inForeground()
        assertTrue(neu.gesperrt.value)
    }

    @Test
    fun `locked after a reboot of the device`() {
        val s = lock().apply { setMinutes(30) }
        s.inBackground()
        jetzt = 5_000L
        s.inForeground()
        assertTrue(s.gesperrt.value)
    }

    @Test
    fun `locked after a reboot, even if the clock is already further`() {
        val s = lock().apply { setMinutes(30) }
        s.inBackground()
        starts = 8
        jetzt += AppLock.MINUTE_MS
        s.inForeground()
        assertTrue("Ein neuer Gerätestart sperrt, auch vor Ablauf der Frist", s.gesperrt.value)
    }

    @Test
    fun `an unreadable boot counter locks, an equal one does not`() {
        val s = lock().apply { setMinutes(30) }
        s.weg(AppLock.MINUTE_MS)
        assertFalse("Derselbe Start und kurz weg: keine Rückfrage", s.gesperrt.value)
        s.inBackground()
        starts = null
        jetzt += AppLock.MINUTE_MS
        s.inForeground()
        assertTrue("Ist der Zähler nicht mehr lesbar, ist ein Neustart nicht ausgeschlossen", s.gesperrt.value)
    }

    @Test
    fun `the widget hides its amounts as soon as the lock can apply`() {
        val s = lock()
        s.inBackground()
        assertFalse("Ohne Sperre zeigt es sie", AppLock.hiddenWidget(ablage))
        s.inForeground()
        s.setMinutes(15)
        assertFalse("Im Vordergrund und entsperrt", AppLock.hiddenWidget(ablage))
        s.inBackground()
        assertTrue("Im Hintergrund, auch vor Ablauf der Frist", AppLock.hiddenWidget(ablage))
        jetzt += 15 * AppLock.MINUTE_MS
        s.inForeground()
        assertTrue(s.gesperrt.value)
        assertTrue("Gesperrt im Vordergrund", AppLock.hiddenWidget(ablage))
        s.entsperrt()
        assertFalse(AppLock.hiddenWidget(ablage))
    }

    @Test
    fun `newly installed with a screen lock the lock is on, otherwise it stays off`() {
        assertTrue(AppLock.DEFAULT_MINUTES in AppLock.CHOICE && AppLock.DEFAULT_MINUTES > 0)
        assertEquals(AppLock.DEFAULT_MINUTES, AppLock.vorgabe(newInstalled = true, deviceSecured = true))
        assertEquals("Ohne Displaysperre liesse sich nicht entsperren", 0, AppLock.vorgabe(newInstalled = true, deviceSecured = false))
        assertEquals("Ein Update stellt nichts um", 0, AppLock.vorgabe(newInstalled = false, deviceSecured = true))
    }
}
