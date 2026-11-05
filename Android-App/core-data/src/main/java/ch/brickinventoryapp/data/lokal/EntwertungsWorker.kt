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
import ch.brickinventoryapp.data.PreferencesManager
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
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
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
        fun prefs(): PreferencesManager
        fun bereiche(): Anwendungsbereiche
    }

    override suspend fun doWork(): Result {
        val server = inputData.getString(SERVER) ?: return Result.success()
        val geheim = inputData.getString(TOKEN) ?: return Result.success()
        val pin = inputData.getString(PIN)
        val zugang = EntryPointAccessors.fromApplication(applicationContext, Zugang::class.java)
        val schritt = withContext(zugang.bereiche().io) {
            entwertungsSchritt(zugang.tresor().oeffne(geheim), runAttemptCount) { zugang.entwerter().entwerte(server, it, pin) }
        }
        return when (schritt) {
            Entwertungsschritt.FERTIG -> Result.success()
            Entwertungsschritt.NOCHMAL -> Result.retry()
            Entwertungsschritt.AUFGEGEBEN -> {
                Protokoll.warnung("Abmelden", "Token am Server nicht entwertet, Auftrag aufgegeben")
                // Still aufzugeben hiesse: Das Token gilt am Server weiter, und niemand weiss es.
                zugang.prefs().merkeGescheiterteEntwertung(server)
                zeigeMeldung(applicationContext, server)
                Result.failure()
            }
        }
    }

    companion object {
        const val SERVER = "server"
        const val TOKEN = "token_geheim"
        const val PIN = "pin"
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
class WorkManagerEntwertung @Inject constructor(
    @param:ApplicationContext private val context: Context,
) : EntwertungsPlaner {
    override fun plane(auftrag: Entwertungsauftrag) {
        val arbeit = OneTimeWorkRequestBuilder<EntwertungsWorker>()
            .setInputData(Data.Builder().putString(EntwertungsWorker.SERVER, auftrag.serverUrl)
                .putString(EntwertungsWorker.TOKEN, auftrag.tokenGeheim)
                .putString(EntwertungsWorker.PIN, auftrag.pin).build())
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueue(arbeit)
    }
}
