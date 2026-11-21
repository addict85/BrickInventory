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
 * Den Preisalarm einzuplanen darf die App nicht schliessen: WorkManager fährt beim ersten
 * Zugriff hoch und kann dabei scheitern. Ausgeführt gegen einen Context ohne App, an dem
 * WorkManager.getInstance() wirft; dass das ViewModel den Fehler meldet, prüft
 * DevicesSettingsViewModelTest.
 *
 * Gegenproben (Patches unter gegenproben/, misst die CI):
 *   einplanen-wirft         einplanen() reicht den Fehler weiter (getOrThrow) → rot „einplanen meldet …“
 *   planer-im-aufrufer      WorkManagerAlarmPlanner ohne withContext(io) → rot „der Planer wechselt …“
 */
class AlarmScheduleTest {

    /** Ohne Application: WorkManager findet keine Konfiguration und wirft. */
    private val withoutApp = object : ContextWrapper(null) {}

    /** Zählt, wie oft Arbeit auf ihn wechselt. */
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
