package ch.brickinventoryapp.data.lokal

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
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.concurrent.TimeUnit
import javax.inject.Inject

/**
 * Sendet den Ausgang, sobald Netz da ist. WorkManager übernimmt Netzbedingung,
 * Rückzug und das Überleben eines Neustarts; die Logik steht in [Abgleich].
 */
@HiltWorker
internal class AusgangWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val abgleich: Abgleich,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        return when (abgleich.sende()) {
            Abgleichsergebnis.SPAETER -> Result.retry()
            Abgleichsergebnis.FERTIG, Abgleichsergebnis.NICHT_ANGEMELDET -> Result.success()
        }
    }

    companion object {
        const val NAME = "ausgang-senden"
    }
}

/**
 * Plant einen Sendelauf. APPEND_OR_REPLACE statt KEEP: Läuft gerade einer und hat
 * den Ausgang schon leer gesehen, käme ein eben eingereihter Posten sonst erst
 * beim nächsten Anlass dran.
 */
internal class WorkManagerPlaner @Inject constructor(
    @param:ApplicationContext private val context: Context,
) : AusgangPlaner {
    override fun plane() {
        val auftrag = OneTimeWorkRequestBuilder<AusgangWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(AusgangWorker.NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, auftrag)
    }
}
