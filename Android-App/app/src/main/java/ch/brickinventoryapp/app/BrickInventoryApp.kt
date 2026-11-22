package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.os.Process
import androidx.work.Configuration
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import ch.brickinventoryapp.services.alarm.PreisalarmWorker
import androidx.hilt.work.HiltWorkerFactory
import ch.brickinventoryapp.data.Alarmablage
import ch.brickinventoryapp.data.Sprachablage
import ch.brickinventoryapp.data.Tokenuebernahme
import ch.brickinventoryapp.data.di.Scopes
import ch.brickinventoryapp.state.ui.Ausgangsmelder
import ch.brickinventoryapp.session.SitzungsRepository
import ch.brickinventoryapp.data.util.LanguageManager
import ch.brickinventoryapp.network.util.Protokoll
import ch.brickinventoryapp.data.util.cleanOldPartListOn
import ch.brickinventoryapp.data.util.raeumeKlartextAnleitungenAuf
import ch.brickinventoryapp.security.cleanPlaintextImageCachesOn
import ch.brickinventoryapp.data.util.raeumeVertraulichePdfsAuf
import android.os.Build
import android.content.BroadcastReceiver
import android.content.Context
import androidx.glance.appwidget.updateAll
import ch.brickinventoryapp.app.widget.SammlungsWidget
import android.content.Intent
import android.content.IntentFilter
import androidx.core.content.ContextCompat
import android.app.KeyguardManager
import ch.brickinventoryapp.security.LockWipe

@HiltAndroidApp
class BrickInventoryApp : Application(), Configuration.Provider {
    // Lazy: the isolated PDF process also creates an Application but must not open any files.
    @Inject lateinit var tokenuebernahmeLazy: dagger.Lazy<Tokenuebernahme>
    @Inject lateinit var alertsLazy: dagger.Lazy<Alarmablage>
    @Inject lateinit var languageLazy: dagger.Lazy<Sprachablage>
    private val tokenuebernahme get() = tokenuebernahmeLazy.get()
    private val alerts get() = alertsLazy.get()
    private val sprache get() = languageLazy.get()
    @Inject lateinit var areas: Scopes
    @Inject lateinit var workerFactory: HiltWorkerFactory
    @Inject lateinit var sessionLazy: dagger.Lazy<SitzungsRepository>
    @Inject lateinit var ausgangsmelderLazy: dagger.Lazy<Ausgangsmelder>
    @Inject lateinit var lockWipeLazy: dagger.Lazy<LockWipe>

    /**
     * WorkManager on demand instead of at start, the counterpart to tools:node="remove"
     * in the manifest: without this interface the first access throws „WorkManager is
     * not initialized properly“. Hilt's factory builds the @HiltWorker.
     */
    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(workerFactory).build()

    override fun onCreate() {
        super.onCreate()
        // In the render process (ui/pdf/PdfRenderDienst) there are neither files nor an account.
        if (Process.isIsolated()) return
        // Session and outbox start with the first MainActivity and then live as long
        // as the process, not like a ViewModel; a worker alone (price alert) does not wake them.
        registerActivityLifecycleCallbacks(AtFirstUi {
            sessionLazy.get().starte()
            ausgangsmelderLazy.get().starte(areas.application)
        })

        // A token of earlier versions under the weaker key moves under the strict one right after
        // unlocking, not only on the next start. The widget redraws:
        // locked it could not read its numbers (DevicesStore.widgetStatus).
        ContextCompat.registerReceiver(this, object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                lockWipeLazy.get().restore()
                areas.application.launch { fangeAusserAbbruch { tokenuebernahme.levelTokenHigh() } }
                areas.application.launch { fangeAusserAbbruch { SammlungsWidget().updateAll(context) } }
            }
        }, IntentFilter(Intent.ACTION_USER_PRESENT), ContextCompat.RECEIVER_NOT_EXPORTED)

        // Screen off with a secure lock: store keys and token leave memory (LockWipe). Without a
        // lock the Keystore releases them anyway; dropping them would only cost reloading.
        ContextCompat.registerReceiver(this, object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (context.getSystemService(KeyguardManager::class.java)?.isDeviceSecure == true) lockWipeLazy.get().wipe()
            }
        }, IntentFilter(Intent.ACTION_SCREEN_OFF), ContextCompat.RECEIVER_NOT_EXPORTED)

        // Cleanup in the background; a plaintext token of older versions never counts, it just goes away.
        areas.application.launch {
            // Voucher PDFs of an aborted run: the viewer was never left.
            fangeAusserAbbruch { raeumeVertraulichePdfsAuf(cacheDir) }
            // Instructions of older versions lay in plaintext; new ones lie encrypted.
            fangeAusserAbbruch { raeumeKlartextAnleitungenAuf(cacheDir) }
            // Image cache of older versions (plaintext) and an expired parts list.
            fangeAusserAbbruch { cleanPlaintextImageCachesOn(cacheDir) }
            fangeAusserAbbruch { cleanOldPartListOn(filesDir, System.currentTimeMillis()) }
            fangeAusserAbbruch { tokenuebernahme.adoptOldToken() }
            // Reschedule the price alert fetch: reset app data or a
            // „Force Stop“ discard the jobs, the switch would otherwise stand on “on”
            // without effect. KEEP leaves a scheduled job unchanged.
            fangeAusserAbbruch {
                if (alerts.alarmMessagesAn.first()) {
                    PreisalarmWorker
                        .einplanen(this@BrickInventoryApp, true)
                        ?.let { Protokoll.warnung("Preisalarm", "Abruf nicht eingeplant", it) }
                }
            }
        }
        // Below Android 13 the app sets its language itself, before the first activity.
        // From the synchronous mirror instead of via runBlocking from the DataStore; if it is missing
        // (saved before the mirror), catch up once — AppCompat then recreates the
        // activity. From 13 on the system remembers the language itself.
        if (Build.VERSION.SDK_INT < 33) {
            val gemerkt = sprache.rememberedLanguage()
            if (gemerkt != null) {
                LanguageManager.applyLanguage(gemerkt)
            } else {
                areas.application.launch(areas.haupt) {
                    val lang = fangeAusserAbbruch { sprache.followUpLanguage() }.getOrNull() ?: return@launch
                    LanguageManager.applyLanguage(lang)
                }
            }
        }
    }
}

/** Calls [los] once when the first MainActivity is created; other activities do not count. */
private class AtFirstUi(private val los: () -> Unit) : Application.ActivityLifecycleCallbacks {
    private var gelaufen = false

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
        if (gelaufen || activity !is MainActivity) return
        gelaufen = true
        los()
    }

    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityResumed(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit
}
