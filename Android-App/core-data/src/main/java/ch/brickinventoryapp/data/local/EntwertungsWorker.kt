package ch.brickinventoryapp.data.local

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import ch.brickinventoryapp.data.JobState
import ch.brickinventoryapp.data.Auftragsablage
import ch.brickinventoryapp.data.Redeemer
import ch.brickinventoryapp.data.DevicesStore
import ch.brickinventoryapp.data.Entwertungsauftrag
import ch.brickinventoryapp.data.RedemptionPlanner
import ch.brickinventoryapp.data.Entwertungsschritt
import ch.brickinventoryapp.data.redemptionStep
import ch.brickinventoryapp.data.onlyUnlocked
import ch.brickinventoryapp.data.di.Scopes
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.data.util.LanguageManager
import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.network.util.Protokoll
import ch.brickinventoryapp.security.Geraetesperre
import ch.brickinventoryapp.security.TokenEncryption
import androidx.hilt.work.HiltWorker
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit
import javax.inject.Inject

/**
 * Invalidates a token whose sign-out at the server did not succeed right away. WorkManager
 * keeps the job across restarts and waits for network; the decisions stand in
 * data/Entwertung.kt.
 */
@HiltWorker
class EntwertungsWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val redeemer: Redeemer,
    private val tresor: TokenEncryption,
    private val areas: Scopes,
    private val lock: Geraetesperre,
    /** Reads the job (Auftragsablage) and records a failed one (Entwertungsprotokoll). */
    private val geraet: DevicesStore,
) : CoroutineWorker(context, params) {

    /** New ones only encrypted ([JOB]); a job of an older version still carries fields. */
    private fun situation(): JobState? {
        inputData.getString(JOB)?.let { return geraet.auftragsablage().lies(it) }
        val server = inputData.getString(SERVER) ?: return null
        val geheim = inputData.getString(TOKEN) ?: return null
        // Jobs of older versions without origin were meant for the registered server.
        val herkunft = inputData.getString(ORIGIN) ?: NetworkPolicy.herkunft(server)
        return JobState.Da(Entwertungsauftrag(server, geheim, inputData.getString(PIN), herkunft))
    }

    override suspend fun doWork(): Result {
        val job = when (val l = withContext(areas.io) { situation() }) {
            null -> return Result.success()
            is JobState.Da -> l.job
            JobState.Gesperrt -> return Result.retry()
            JobState.Unlesbar -> {
                // Without an address one cannot say either which access still applies.
                Protokoll.warnung("Abmelden", "Abmeldeauftrag nicht lesbar, aufgegeben")
                return Result.failure()
            }
        }
        val server = job.serverUrl
        val schritt = withContext(areas.io) {
            redemptionStep(tresor.oeffne(job.tokenSecret), runAttemptCount, lock.gesperrt()) {
                redeemer.redeem(server, it, job.pin, job.herkunft)
            }
        }
        return when (schritt) {
            Entwertungsschritt.FERTIG -> Result.success()
            Entwertungsschritt.AGAIN -> Result.retry()
            Entwertungsschritt.GIVEN_UP -> {
                Protokoll.warnung("Abmelden", "Token am Server nicht entwertet, Auftrag aufgegeben")
                // Giving up silently would mean: the token keeps applying at the server, and nobody knows.
                geraet.rememberFailedRedemption(server)
                showMessage(applicationContext, server)
                Result.failure()
            }
        }
    }

    companion object {
        /** The whole job as a ciphertext (Auftragsablage). */
        const val JOB = "auftrag_geheim"
        /** Fields of older versions: only read any more. */
        const val SERVER = "server"
        const val TOKEN = "token_geheim"
        const val PIN = "pin"
        const val ORIGIN = "herkunft"
        private const val CHANNEL = "abmeldung"

        /** The hint to sign out users in the web app under „Angemeldete Geräte“. */
        fun showMessage(context: Context, server: String) {
            // From Android 13 a runtime permission; without it the hint stays for the next start (AppViewModel).
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(
                    context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
            val texts = LanguageManager.localizedContext(context)
            val mgr = context.getSystemService(NotificationManager::class.java) ?: return
            mgr.createNotificationChannel(NotificationChannel(CHANNEL,
                texts.getString(R.string.abmeldung_kanal), NotificationManager.IMPORTANCE_DEFAULT))
            val adresse = NetworkPolicy.ansicht(server)?.adresse ?: server
            NotificationManagerCompat.from(context).notify(CHANNEL, adresse.hashCode(), meldung(texts, adresse))
        }

        /** The server's address only when unlocked; locked only the title stands there. */
        internal fun meldung(texts: Context, adresse: String): Notification {
            val titel = texts.getString(R.string.abmeldung_gescheitert_titel)
            val text = texts.getString(R.string.abmeldung_gescheitert_text, adresse)
            return NotificationCompat.Builder(texts, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentTitle(titel)
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .onlyUnlocked(texts, CHANNEL, titel, android.R.drawable.ic_dialog_alert)
                .setAutoCancel(true)
                .build()
        }
    }
}

/** The job under the details' key, the same for scheduler and worker. */
internal fun DevicesStore.auftragsablage() = Auftragsablage(this::verschluessleDetail, this::openDetail)

/** One job per sign-out; without network it waits, failed it comes back with backoff. */
internal class WorkManagerRedemption @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val geraet: DevicesStore,
) : RedemptionPlanner {
    override fun plane(job: Entwertungsauftrag) {
        // Locked no ciphertext arises; then the user learns of it at the next start,
        // instead of the address lying readably in the queue.
        val geheim = geraet.auftragsablage().ablegen(job)
            ?: return geraet.rememberFailedRedemption(job.serverUrl)
        val arbeit = OneTimeWorkRequestBuilder<EntwertungsWorker>()
            .setInputData(Data.Builder().putString(EntwertungsWorker.JOB, geheim).build())
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueue(arbeit)
    }
}
