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
 * Entwertet ein Token, dessen Abmelden am Server nicht gleich gelang. WorkManager
 * hält den Auftrag über Neustarts und wartet auf Netz; die Entscheidungen stehen in
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
    /** Liest den Auftrag (Auftragsablage) und merkt einen gescheiterten (Entwertungsprotokoll). */
    private val geraet: DevicesStore,
) : CoroutineWorker(context, params) {

    /** Neu nur verschlüsselt ([JOB]); ein Auftrag älterer Fassung trägt noch Felder. */
    private fun situation(): JobState? {
        inputData.getString(JOB)?.let { return geraet.auftragsablage().lies(it) }
        val server = inputData.getString(SERVER) ?: return null
        val geheim = inputData.getString(TOKEN) ?: return null
        // Aufträge älterer Fassungen ohne Herkunft galten dem eingetragenen Server.
        val herkunft = inputData.getString(ORIGIN) ?: NetworkPolicy.herkunft(server)
        return JobState.Da(Entwertungsauftrag(server, geheim, inputData.getString(PIN), herkunft))
    }

    override suspend fun doWork(): Result {
        val job = when (val l = withContext(areas.io) { situation() }) {
            null -> return Result.success()
            is JobState.Da -> l.job
            JobState.Gesperrt -> return Result.retry()
            JobState.Unlesbar -> {
                // Ohne Adresse lässt sich auch nicht sagen, welcher Zugang noch gilt.
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
                // Still aufzugeben hiesse: Das Token gilt am Server weiter, und niemand weiss es.
                geraet.rememberFailedRedemption(server)
                showMessage(applicationContext, server)
                Result.failure()
            }
        }
    }

    companion object {
        /** Der ganze Auftrag als Geheimtext (Auftragsablage). */
        const val JOB = "auftrag_geheim"
        /** Felder älterer Fassungen: nur noch gelesen. */
        const val SERVER = "server"
        const val TOKEN = "token_geheim"
        const val PIN = "pin"
        const val ORIGIN = "herkunft"
        private const val CHANNEL = "abmeldung"

        /** Der Hinweis, den Nutzer in der Webapp unter „Angemeldete Geräte“ abzumelden. */
        fun showMessage(context: Context, server: String) {
            // Ab Android 13 Laufzeitrecht; ohne es bleibt der Hinweis beim nächsten Start (AppViewModel).
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(
                    context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
            val texts = LanguageManager.localizedContext(context)
            val mgr = context.getSystemService(NotificationManager::class.java) ?: return
            mgr.createNotificationChannel(NotificationChannel(CHANNEL,
                texts.getString(R.string.abmeldung_kanal), NotificationManager.IMPORTANCE_DEFAULT))
            val adresse = NetworkPolicy.ansicht(server)?.adresse ?: server
            NotificationManagerCompat.from(context).notify(CHANNEL, adresse.hashCode(), meldung(texts, adresse))
        }

        /** Die Adresse des Servers nur entsperrt; gesperrt steht allein der Titel da. */
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

/** Der Auftrag unter dem Schlüssel der Angaben, für Planer und Arbeiter derselbe. */
internal fun DevicesStore.auftragsablage() = Auftragsablage(this::verschluessleDetail, this::openDetail)

/** Ein Auftrag je Abmeldung; ohne Netz wartet er, gescheitert kommt er mit Rückzug wieder. */
internal class WorkManagerRedemption @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val geraet: DevicesStore,
) : RedemptionPlanner {
    override fun plane(job: Entwertungsauftrag) {
        // Gesperrt entsteht kein Geheimtext; dann weiss der Nutzer beim nächsten Start Bescheid,
        // statt dass die Adresse lesbar in der Warteschlange läge.
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
