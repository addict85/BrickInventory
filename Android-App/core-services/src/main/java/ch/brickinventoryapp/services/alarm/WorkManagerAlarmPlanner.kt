package ch.brickinventoryapp.services.alarm

import android.content.Context
import ch.brickinventoryapp.dataapi.device.AlarmPlanner
import ch.brickinventoryapp.model.coroutines.BrickDispatchers
import ch.brickinventoryapp.model.coroutines.Dispatcher
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import javax.inject.Inject

/**
 * The switch in settings schedules via this path. Not on the
 * main thread: WorkManager reads from disk on first access, and that
 * crashed the app.
 */
internal class WorkManagerAlarmPlanner @Inject constructor(
    @param:ApplicationContext private val context: Context,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
) : AlarmPlanner {
    override suspend fun schedule(an: Boolean): Throwable? = withContext(io) {
        PriceAlarmWorker.schedule(context, an)
    }
}
