package ch.brickinventoryapp.app

import android.app.Activity
import android.app.Application
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.os.Process
import androidx.core.content.ContextCompat
import androidx.glance.appwidget.updateAll
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import ch.brickinventoryapp.app.widget.CollectionWidget
import ch.brickinventoryapp.data.AlarmStore
import ch.brickinventoryapp.data.LanguageStore
import ch.brickinventoryapp.data.TokenAdoption
import ch.brickinventoryapp.data.di.Scopes
import ch.brickinventoryapp.data.util.LanguageManager
import ch.brickinventoryapp.data.util.cleanOldPartListOn
import ch.brickinventoryapp.data.util.cleanUpConfidentialPdfs
import ch.brickinventoryapp.data.util.cleanUpPlaintextInstructions
import ch.brickinventoryapp.model.util.LockWipe
import ch.brickinventoryapp.model.util.catchUnlessCancelled
import ch.brickinventoryapp.network.util.AppLog
import ch.brickinventoryapp.security.cleanPlaintextImageCachesOn
import ch.brickinventoryapp.services.alarm.PriceAlarmWorker
import ch.brickinventoryapp.session.SessionRepository
import ch.brickinventoryapp.state.ui.OutboxNotifier
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltAndroidApp
class BrickInventoryApp : Application(), Configuration.Provider {
    // Lazy: the isolated PDF process also creates an Application but must not open any files.
    @Inject lateinit var tokenAdoptionLazy: dagger.Lazy<TokenAdoption>
    @Inject lateinit var alertsLazy: dagger.Lazy<AlarmStore>
    @Inject lateinit var languageLazy: dagger.Lazy<LanguageStore>
    private val tokenAdoption get() = tokenAdoptionLazy.get()
    private val alerts get() = alertsLazy.get()
    private val language get() = languageLazy.get()
    @Inject lateinit var areas: Scopes
    @Inject lateinit var workerFactory: HiltWorkerFactory
    @Inject lateinit var sessionLazy: dagger.Lazy<SessionRepository>
    @Inject lateinit var outboxNotifierLazy: dagger.Lazy<OutboxNotifier>
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
        // In the render process (ui/pdf/PdfRenderService) there are neither files nor an account.
        if (Process.isIsolated()) return
        // Session and outbox start with the first MainActivity and then live as long
        // as the process, not like a ViewModel; a worker alone (price alert) does not wake them.
        registerActivityLifecycleCallbacks(AtFirstUi {
            sessionLazy.get().launch()
            outboxNotifierLazy.get().launch(areas.application)
        })

        // A token of earlier versions under the weaker key moves under the strict one right after
        // unlocking, not only on the next start. The widget redraws:
        // locked it could not read its numbers (DevicesStore.widgetStatus).
        ContextCompat.registerReceiver(this, object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                lockWipeLazy.get().restore()
                areas.application.launch { catchUnlessCancelled { tokenAdoption.levelTokenHigh() } }
                areas.application.launch { catchUnlessCancelled { CollectionWidget().updateAll(context) } }
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
            catchUnlessCancelled { cleanUpConfidentialPdfs(cacheDir) }
            // Instructions of older versions lay in plaintext; new ones lie encrypted.
            catchUnlessCancelled { cleanUpPlaintextInstructions(cacheDir) }
            // Image cache of older versions (plaintext) and an expired parts list.
            catchUnlessCancelled { cleanPlaintextImageCachesOn(cacheDir) }
            catchUnlessCancelled { cleanOldPartListOn(filesDir, System.currentTimeMillis()) }
            catchUnlessCancelled { tokenAdoption.adoptOldToken() }
            // Reschedule the price alert fetch: reset app data or a
            // „Force Stop“ discard the jobs, the switch would otherwise stand on “on”
            // without effect. KEEP leaves a scheduled job unchanged.
            catchUnlessCancelled {
                if (alerts.alarmMessagesEnabled.first()) {
                    PriceAlarmWorker
                        .schedule(this@BrickInventoryApp, true)
                        ?.let { AppLog.warning("Preisalarm", "Abruf nicht eingeplant", it) }
                }
            }
        }
        // Below Android 13 the app sets its language itself, before the first activity.
        // From the synchronous mirror instead of via runBlocking from the DataStore; if it is missing
        // (saved before the mirror), catch up once — AppCompat then recreates the
        // activity. From 13 on the system remembers the language itself.
        if (Build.VERSION.SDK_INT < 33) {
            val wanted = language.rememberedLanguage()
            if (wanted != null) {
                LanguageManager.applyLanguage(wanted)
            } else {
                areas.application.launch(areas.main) {
                    val lang = catchUnlessCancelled { language.followUpLanguage() }.getOrNull() ?: return@launch
                    LanguageManager.applyLanguage(lang)
                }
            }
        }
    }
}

/** Calls [go] once when the first MainActivity is created; other activities do not count. */
private class AtFirstUi(private val go: () -> Unit) : Application.ActivityLifecycleCallbacks {
    private var ran = false

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
        if (ran || activity !is MainActivity) return
        ran = true
        go()
    }

    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityResumed(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit
}
