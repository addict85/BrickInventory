package ch.brickinventoryapp.data.lokal

import android.Manifest
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
import ch.brickinventoryapp.data.Entwerter
import ch.brickinventoryapp.data.Entwertungsprotokoll
import ch.brickinventoryapp.data.Entwertungsauftrag
import ch.brickinventoryapp.data.EntwertungsPlaner
import ch.brickinventoryapp.data.Entwertungsschritt
import ch.brickinventoryapp.data.entwertungsSchritt
import ch.brickinventoryapp.di.Anwendungsbereiche
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.util.LanguageManager
import ch.brickinventoryapp.util.NetworkPolicy
import ch.brickinventoryapp.util.Protokoll
import ch.brickinventoryapp.util.TokenVerschluesselung
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
    private val entwerter: Entwerter,
    private val tresor: TokenVerschluesselung,
    private val protokoll: Entwertungsprotokoll,
    private val bereiche: Anwendungsbereiche,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val server = inputData.getString(SERVER) ?: return Result.success()
        val geheim = inputData.getString(TOKEN) ?: return Result.success()
        val pin = inputData.getString(PIN)
        // Aufträge älterer Fassungen tragen keine Herkunft; sie galten dem eingetragenen Server.
        val herkunft = inputData.getString(HERKUNFT) ?: NetworkPolicy.herkunft(server)
        val schritt = withContext(bereiche.io) {
            entwertungsSchritt(tresor.oeffne(geheim), runAttemptCount) { entwerter.entwerte(server, it, pin, herkunft) }
        }
        return when (schritt) {
            Entwertungsschritt.FERTIG -> Result.success()
            Entwertungsschritt.NOCHMAL -> Result.retry()
            Entwertungsschritt.AUFGEGEBEN -> {
                Protokoll.warnung("Abmelden", "Token am Server nicht entwertet, Auftrag aufgegeben")
                // Still aufzugeben hiesse: Das Token gilt am Server weiter, und niemand weiss es.
                protokoll.merkeGescheiterteEntwertung(server)
                zeigeMeldung(applicationContext, server)
                Result.failure()
            }
        }
    }

    companion object {
        const val SERVER = "server"
        const val TOKEN = "token_geheim"
        const val PIN = "pin"
        const val HERKUNFT = "herkunft"
        private const val KANAL = "abmeldung"

        /** Der Hinweis, den Nutzer in der Webapp unter „Angemeldete Geräte“ abzumelden. */
        fun zeigeMeldung(context: Context, server: String) {
            // Ab Android 13 Laufzeitrecht; ohne es bleibt der Hinweis beim nächsten Start (AppViewModel).
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(
                    context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
            val texte = LanguageManager.localizedContext(context)
            val mgr = context.getSystemService(NotificationManager::class.java) ?: return
            mgr.createNotificationChannel(NotificationChannel(KANAL,
                texte.getString(R.string.abmeldung_kanal), NotificationManager.IMPORTANCE_DEFAULT))
            val adresse = NetworkPolicy.ansicht(server)?.adresse ?: server
            val text = texte.getString(R.string.abmeldung_gescheitert_text, adresse)
            val meldung = NotificationCompat.Builder(context, KANAL)
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentTitle(texte.getString(R.string.abmeldung_gescheitert_titel))
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .build()
            NotificationManagerCompat.from(context).notify(KANAL, adresse.hashCode(), meldung)
        }
    }
}

/** Ein Auftrag je Abmeldung; ohne Netz wartet er, gescheitert kommt er mit Rückzug wieder. */
internal class WorkManagerEntwertung @Inject constructor(
    @param:ApplicationContext private val context: Context,
) : EntwertungsPlaner {
    override fun plane(auftrag: Entwertungsauftrag) {
        val arbeit = OneTimeWorkRequestBuilder<EntwertungsWorker>()
            .setInputData(Data.Builder().putString(EntwertungsWorker.SERVER, auftrag.serverUrl)
                .putString(EntwertungsWorker.TOKEN, auftrag.tokenGeheim)
                .putString(EntwertungsWorker.PIN, auftrag.pin)
                .putString(EntwertungsWorker.HERKUNFT, auftrag.herkunft).build())
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueue(arbeit)
    }
}
