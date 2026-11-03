package ch.brickinventoryapp.data.lokal

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import ch.brickinventoryapp.data.Entwerter
import ch.brickinventoryapp.data.Entwertungsauftrag
import ch.brickinventoryapp.data.EntwertungsPlaner
import ch.brickinventoryapp.data.Entwertungsschritt
import ch.brickinventoryapp.data.entwertungsSchritt
import ch.brickinventoryapp.util.Protokoll
import ch.brickinventoryapp.util.TokenVerschluesselung
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit
import javax.inject.Inject

/**
 * Entwertet ein Token, dessen Abmelden am Server nicht gleich gelang. WorkManager
 * hält den Auftrag über Neustarts und wartet auf Netz; die Entscheidungen stehen in
 * data/Entwertung.kt. EntryPoint statt @HiltWorker wie beim AusgangWorker.
 */
class EntwertungsWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    @EntryPoint
    @InstallIn(SingletonComponent::class)
    interface Zugang {
        fun entwerter(): Entwerter
        fun tresor(): TokenVerschluesselung
    }

    override suspend fun doWork(): Result {
        val server = inputData.getString(SERVER) ?: return Result.success()
        val geheim = inputData.getString(TOKEN) ?: return Result.success()
        val zugang = EntryPointAccessors.fromApplication(applicationContext, Zugang::class.java)
        val schritt = withContext(Dispatchers.IO) {
            entwertungsSchritt(zugang.tresor().oeffne(geheim), runAttemptCount) { zugang.entwerter().entwerte(server, it) }
        }
        return when (schritt) {
            Entwertungsschritt.FERTIG -> Result.success()
            Entwertungsschritt.NOCHMAL -> Result.retry()
            Entwertungsschritt.AUFGEGEBEN -> {
                Protokoll.warnung("Abmelden", "Token am Server nicht entwertet, Auftrag aufgegeben")
                Result.failure()
            }
        }
    }

    companion object {
        const val SERVER = "server"
        const val TOKEN = "token_geheim"
    }
}

/** Ein Auftrag je Abmeldung; ohne Netz wartet er, gescheitert kommt er mit Rückzug wieder. */
class WorkManagerEntwertung @Inject constructor(
    @param:ApplicationContext private val context: Context,
) : EntwertungsPlaner {
    override fun plane(auftrag: Entwertungsauftrag) {
        val arbeit = OneTimeWorkRequestBuilder<EntwertungsWorker>()
            .setInputData(Data.Builder().putString(EntwertungsWorker.SERVER, auftrag.serverUrl)
                .putString(EntwertungsWorker.TOKEN, auftrag.tokenGeheim).build())
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueue(arbeit)
    }
}
