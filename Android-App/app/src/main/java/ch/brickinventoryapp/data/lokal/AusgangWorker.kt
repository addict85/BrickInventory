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
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import java.util.concurrent.TimeUnit
import javax.inject.Inject

/**
 * Sendet den Ausgang, sobald Netz da ist. WorkManager übernimmt Netzbedingung,
 * Rückzug und das Überleben eines Neustarts; die Logik steht in [Abgleich].
 * EntryPoint statt @HiltWorker wie beim PreisalarmWorker: weniger Apparat.
 */
class AusgangWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    @EntryPoint
    @InstallIn(SingletonComponent::class)
    interface Zugang {
        fun abgleich(): Abgleich
    }

    override suspend fun doWork(): Result {
        val abgleich = EntryPointAccessors.fromApplication(applicationContext, Zugang::class.java).abgleich()
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
class WorkManagerPlaner @Inject constructor(
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
