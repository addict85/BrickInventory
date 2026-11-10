package ch.brickinventoryapp.dienste

import android.content.ContextWrapper
import ch.brickinventoryapp.dienste.alarm.PreisalarmWorker
import ch.brickinventoryapp.dienste.alarm.WorkManagerAlarmPlaner
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
 * GeraeteEinstellungenViewModelTest.
 *
 * Gegenproben (Patches unter gegenproben/, misst die CI):
 *   einplanen-wirft         einplanen() reicht den Fehler weiter (getOrThrow) → rot „einplanen meldet …“
 *   planer-im-aufrufer      WorkManagerAlarmPlaner ohne withContext(io) → rot „der Planer wechselt …“
 */
class AlarmEinplanenTest {

    /** Ohne Application: WorkManager findet keine Konfiguration und wirft. */
    private val ohneApp = object : ContextWrapper(null) {}

    /** Zählt, wie oft Arbeit auf ihn wechselt. */
    private class ZaehlenderDispatcher : CoroutineDispatcher() {
        var wechsel = 0
        override fun dispatch(context: CoroutineContext, block: Runnable) {
            wechsel++
            Dispatchers.Default.dispatch(context, block)
        }
    }

    @Test
    fun `einplanen meldet einen Fehler des WorkManagers, statt zu werfen`() {
        assertNotNull("WorkManager ohne Konfiguration und trotzdem kein Fehler?", PreisalarmWorker.einplanen(ohneApp, an = true))
        assertNotNull(PreisalarmWorker.einplanen(ohneApp, an = false))
    }

    @Test
    fun `der Planer wechselt fuer WorkManager auf seinen Dispatcher`() = runBlocking {
        val io = ZaehlenderDispatcher()
        val fehler = WorkManagerAlarmPlaner(ohneApp, io).einplanen(true)
        assertNotNull(fehler)
        assertTrue("WorkManager lief auf dem Thread des Aufrufers (am Schalter: dem Hauptthread)", io.wechsel > 0)
    }
}
