package ch.brickinventoryapp.ui

import ch.brickinventoryapp.ui.components.AppLock
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The app lock: freshly installed with screen lock on, otherwise off; when on, it only locks after
 * the configured minutes in the background elapse, and a new Activity (rotation, process death) doesn't
 * unlock it on its own.
 *
 * Counter-checks (measured locally with kotlinc on Nov 9, 2026):
 *   A  in inForeground() every return locked (`now - since >= 0`) → red „vor Ablauf der Frist fragt die App nicht“
 * ; counter-checks/app-sperre-sofort.patch
 *   B  state only in memory (`MutableStateFlow(false)`) → red „eine neue Activity entsperrt nicht“
 * ; counter-checks/app-sperre-vergisst-beim-drehen.patch
 *   C  in inForeground() the device-boot comparison removed (`restarted = false`)
 *      → red „locked after a reboot, even if the clock is already further“;
 *      counter-checks/app-sperre-ohne-geraetestart.patch
 *   D  (kotlinc) hiddenWidget() only `store.locked()` → red „das Widget verdeckt seine Betraege, sobald die Sperre greifen kann“
 * ; counter-checks/widget-trotz-sperre.patch
 *   E  (kotlinc) default() always 0 → red „neu installiert mit Displaysperre …“;
 *      counter-checks/app-sperre-vorgabe-aus.patch
 */
class AppLockTest {

    private class Memory : AppLock.Store {
        var storedMinutes = 0
        var since: Long? = null
        var start: Int? = null
        var lockedState = false
        override fun minutes() = storedMinutes
        override fun setMinutes(minutes: Int) { this.storedMinutes = minutes }
        override fun backgroundSince() = since
        override fun rememberBackground(since: Long?) { this.since = since }
        override fun backgroundStart() = start
        override fun rememberBackgroundStart(start: Int?) { this.start = start }
        override fun locked() = lockedState
        override fun setLocked(on: Boolean) { lockedState = on }
    }

    private var now = 1_000_000L
    private var starts: Int? = 7
    private val store = Memory()
    private fun lock() = AppLock({ now }, store) { starts }

    private fun AppLock.gone(ms: Long) {
        inBackground()
        now += ms
        inForeground()
    }

    @Test
    fun `off by default`() {
        val s = lock()
        s.gone(24 * 60 * AppLock.MINUTE_MS)
        assertFalse(s.locked.value)
    }

    @Test
    fun `before the deadline expires the app does not ask`() {
        val s = lock().apply { setMinutes(5) }
        s.gone(5 * AppLock.MINUTE_MS - 1)
        assertFalse(s.locked.value)
        s.gone(1_000)
        assertFalse("every return restarts the deadline", s.locked.value)
    }

    @Test
    fun `after expiry locked until unlocked`() {
        val s = lock().apply { setMinutes(1) }
        s.gone(AppLock.MINUTE_MS)
        assertTrue(s.locked.value)
        s.gone(1_000)
        assertTrue("briefly away and back does not unlock", s.locked.value)
        s.unlocked()
        assertFalse(s.locked.value)
    }

    @Test
    fun `a new activity does not unlock`() {
        lock().apply { setMinutes(15) }.gone(16 * AppLock.MINUTE_MS)
        val newValue = lock()
        newValue.inForeground()
        assertTrue(newValue.locked.value)
    }

    @Test
    fun `locked after a reboot of the device`() {
        val s = lock().apply { setMinutes(30) }
        s.inBackground()
        now = 5_000L
        s.inForeground()
        assertTrue(s.locked.value)
    }

    @Test
    fun `locked after a reboot, even if the clock is already further`() {
        val s = lock().apply { setMinutes(30) }
        s.inBackground()
        starts = 8
        now += AppLock.MINUTE_MS
        s.inForeground()
        assertTrue("a new device boot locks, even before the deadline expires", s.locked.value)
    }

    @Test
    fun `an unreadable boot counter locks, an equal one does not`() {
        val s = lock().apply { setMinutes(30) }
        s.gone(AppLock.MINUTE_MS)
        assertFalse("the same boot and briefly away: no confirmation", s.locked.value)
        s.inBackground()
        starts = null
        now += AppLock.MINUTE_MS
        s.inForeground()
        assertTrue("if the counter is no longer readable, a reboot is not ruled out", s.locked.value)
    }

    @Test
    fun `the widget hides its amounts as soon as the lock can apply`() {
        val s = lock()
        s.inBackground()
        assertFalse("without a lock it shows them", AppLock.hiddenWidget(store))
        s.inForeground()
        s.setMinutes(15)
        assertFalse("in the foreground and unlocked", AppLock.hiddenWidget(store))
        s.inBackground()
        assertTrue("in the background, even before the deadline expires", AppLock.hiddenWidget(store))
        now += 15 * AppLock.MINUTE_MS
        s.inForeground()
        assertTrue(s.locked.value)
        assertTrue("locked in the foreground", AppLock.hiddenWidget(store))
        s.unlocked()
        assertFalse(AppLock.hiddenWidget(store))
    }

    @Test
    fun `newly installed with a screen lock the lock is on, otherwise it stays off`() {
        assertTrue(AppLock.DEFAULT_MINUTES in AppLock.CHOICE && AppLock.DEFAULT_MINUTES > 0)
        assertEquals(AppLock.DEFAULT_MINUTES, AppLock.default(newInstalled = true, deviceSecured = true))
        assertEquals("without a screen lock it could not be unlocked", 0, AppLock.default(newInstalled = true, deviceSecured = false))
        assertEquals("an update changes nothing", 0, AppLock.default(newInstalled = false, deviceSecured = true))
    }
}
