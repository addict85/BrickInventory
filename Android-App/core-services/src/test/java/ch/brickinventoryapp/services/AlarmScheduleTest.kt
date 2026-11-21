package ch.brickinventoryapp.services

import android.content.ContextWrapper
import ch.brickinventoryapp.services.alarm.PreisalarmWorker
import ch.brickinventoryapp.services.alarm.WorkManagerAlarmPlanner
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.coroutines.CoroutineContext

/**
 * Scheduling the price alert must not crash the app: WorkManager boots up on first
 * access and can fail doing so. Run against a context without an app, where
 * WorkManager.getInstance() throws; that the ViewModel reports the error is checked by
 * DevicesSettingsViewModelTest.
 *
 * Counter-checks (patches under gegenproben/, measured by CI):
 *   einplanen-wirft         einplanen() passes the error on (getOrThrow) → red „einplanen meldet …“
 *   planer-im-aufrufer      WorkManagerAlarmPlanner without withContext(io) → red „der Planer wechselt …“
 */
class AlarmScheduleTest {

    /** Without an Application: WorkManager finds no configuration and throws. */
    private val withoutApp = object : ContextWrapper(null) {}

    /** Counts how often work switches to it. */
    private class CountingDispatcher : CoroutineDispatcher() {
        var switch = 0
        override fun dispatch(context: CoroutineContext, block: Runnable) {
            switch++
            Dispatchers.Default.dispatch(context, block)
        }
    }

    @Test
    fun `scheduling reports an error of the WorkManager instead of throwing`() {
        assertNotNull("WorkManager ohne Konfiguration und trotzdem kein Fehler?", PreisalarmWorker.einplanen(withoutApp, an = true))
        assertNotNull(PreisalarmWorker.einplanen(withoutApp, an = false))
    }

    @Test
    fun `the scheduler switches to its dispatcher for WorkManager`() = runBlocking {
        val io = CountingDispatcher()
        val fehler = WorkManagerAlarmPlanner(withoutApp, io).einplanen(true)
        assertNotNull(fehler)
        assertTrue("WorkManager lief auf dem Thread des Aufrufers (am Schalter: dem Hauptthread)", io.switch > 0)
    }
}
