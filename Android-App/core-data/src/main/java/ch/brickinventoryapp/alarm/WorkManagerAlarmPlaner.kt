package ch.brickinventoryapp.alarm

import android.content.Context
import ch.brickinventoryapp.data.AlarmPlaner
import ch.brickinventoryapp.di.BrickDispatchers
import ch.brickinventoryapp.di.Dispatcher
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import javax.inject.Inject

/**
 * Der Schalter in den Einstellungen plant über diesen Weg ein. Nicht auf dem
 * Hauptthread: WorkManager liest beim ersten Zugriff von der Platte, und das
 * brachte die App zum Absturz.
 */
class WorkManagerAlarmPlaner @Inject constructor(
    @param:ApplicationContext private val context: Context,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
) : AlarmPlaner {
    override suspend fun einplanen(an: Boolean): Throwable? = withContext(io) {
        PreisalarmWorker.einplanen(context, an)
    }
}
