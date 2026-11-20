package ch.brickinventoryapp.data.local

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.hilt.work.HiltWorker
import ch.brickinventoryapp.security.Geraetesperre
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import ch.brickinventoryapp.offline.ExitPlanner

/**
 * Sendet den Ausgang, sobald Netz da ist. WorkManager übernimmt Netzbedingung,
 * Rückzug und das Überleben eines Neustarts; die Logik steht in [Abgleich].
 */
@HiltWorker
internal class ExitWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val sync: Abgleich,
    private val lock: Geraetesperre,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result =
        if (sync.send().again(lock.gesperrt())) Result.retry() else Result.success()

    companion object {
        const val NAME = "ausgang-senden"
    }
}

/**
 * Plant einen Sendelauf. APPEND_OR_REPLACE statt KEEP: Läuft gerade einer und hat
 * den Ausgang schon leer gesehen, käme ein eben eingereihter Posten sonst erst
 * beim nächsten Anlass dran.
 */
internal class WorkManagerPlanner @Inject constructor(
    @param:ApplicationContext private val context: Context,
) : ExitPlanner {
    override fun plane() {
        val job = OneTimeWorkRequestBuilder<ExitWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(ExitWorker.NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, job)
    }
}
