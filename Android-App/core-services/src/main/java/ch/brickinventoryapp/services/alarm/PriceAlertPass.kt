package ch.brickinventoryapp.services.alarm

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import ch.brickinventoryapp.data.Alarmablage
import ch.brickinventoryapp.data.Startziel
import ch.brickinventoryapp.data.Credentials
import ch.brickinventoryapp.data.util.LanguageManager
import ch.brickinventoryapp.model.util.numbersLocale
import ch.brickinventoryapp.model.domain.PriceAlertView
import ch.brickinventoryapp.data.repository.AlarmRepository
import ch.brickinventoryapp.resources.R
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.first
import java.util.Locale
import javax.inject.Inject

/** One fetch of triggered price alerts; the worker hourly, the app on opening. */
interface PriceAlertRepository {
    /** @return false only when the server was not reachable. */
    suspend fun pass(): Boolean
}

/** Query, display, set marker — with the stores from the constructor instead of from an EntryPoint. */
internal class PriceAlertPass @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val alerts: AlarmRepository,
    private val alarm: Alarmablage,
    private val access: Credentials,
    private val startziel: Startziel,
) : PriceAlertRepository {
    /**
     * One run: query, display, set marker. Here instead of in doWork(), because
     * opening the app also fetches (like the web app on sign-in) — otherwise a
     * notification could come up to an hour late. The marker prevents duplicate notifications:
     * every run asks „since when?“ and writes the server's time back.
     *
     * @return false only when the server was not reachable. Disabled or
     *         signed out is a successful run with nothing to do — a retry()
     *         would keep trying in vain.
     */
    override suspend fun pass(): Boolean {
        if (!alarm.alarmMessagesAn.first()) return true
        if (access.tokenJetzt().isBlank()) return true

        val marke = alarm.alarmBrand.first()
        return when (val e = Alarmabholung.fetch(marke) { seit -> alerts.getPendingAlerts(seit) }) {
            is Alarmabholung.Ergebnis.Fehlgeschlagen -> false

            is Alarmabholung.Ergebnis.Markiert -> {
                alarm.setAlarmBrand(e.neueMarke)
                true
            }

            is Alarmabholung.Ergebnis.Geholt -> {
                zeige(e.meldungen)
                // ALWAYS store it, even without a notification — otherwise the
                // next run would query from the old timestamp again and
                // bring in the same notification a second time.
                alarm.setAlarmBrand(e.neueMarke)
                true
            }
        }
    }

    /**
     * Show the notifications — one per crossed threshold, grouped under a
     * summary: you want to know which alert fired without opening the app.
     */
    private fun zeige(meldungen: List<PriceAlertView>) {
        if (meldungen.isEmpty()) return
        // From Android 13, POST_NOTIFICATIONS is a runtime permission.
        // Without it notify() doesn't throw, it simply does nothing —
        // which is why this checks it rather than relying on the absence of a crash.
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(
                context, android.Manifest.permission.POST_NOTIFICATIONS
            ) != PackageManager.PERMISSION_GRANTED
        ) return

        val mgr = context.getSystemService(NotificationManager::class.java) ?: return
        mgr.createNotificationChannel(
            NotificationChannel(
                PreisalarmWorker.CHANNEL,
                context.getString(R.string.alert_channel_name),
                // DEFAULT, not HIGH: a price alert is important, but
                // not urgent — it shouldn't slide over the screen
                // while someone is doing something else.
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply { description = context.getString(R.string.alert_channel_desc) }
        )

        // In the app's language: before Android 13 the background would otherwise see the system's.
        val texts = LanguageManager.localizedContext(context)
        val unter = texts.getString(R.string.detail_alert_below)
        val ueber = texts.getString(R.string.detail_alert_above)
        val zahlen = numbersLocale(texts.resources.configuration.locales[0], Locale.getDefault())
        val nm = NotificationManagerCompat.from(context)
        for ((i, a) in meldungen.withIndex()) {
            // ── Tapping opens the set ──
            //
            // The target is the app's own, non-exported entry point (launch target); it passes it on to the
            // running app. One requestCode per set, otherwise the system would deliver the same
            // PendingIntent and an older notification would open the wrong set. The class comes in
            // as a class, not as a name via Class.forName(), so R8 keeps it without a keep rule.
            val ziel = Intent(context, startziel.aktivitaet).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
                putExtra(PreisalarmWorker.EXTRA_SET, a.setNumber)
            }
            val tippen = PendingIntent.getActivity(
                context,
                (a.setNumber + a.condition).hashCode(),
                ziel,
                // IMMUTABLE is mandatory from Android 12 unless
                // MUTABLE is explicitly requested. We fill the
                // intent completely, so there's nothing left to add.
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val n = PreisalarmWorker.meldung(context, Alarmabholung.text(a, unter, ueber, zahlen), tippen)
            // The set number as the ID: two notifications for the same set
            // overwrite each other instead of stacking.
            nm.notify(PreisalarmWorker.CHANNEL + a.setNumber + a.condition, i + 1, n)
        }
    }
}
