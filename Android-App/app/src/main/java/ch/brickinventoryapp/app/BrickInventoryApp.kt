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

@HiltAndroidApp
class BrickInventoryApp : Application(), Configuration.Provider {
    // Lazy: Der isolierte PDF-Prozess erzeugt auch eine Application, darf aber keine Dateien öffnen.
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

    /**
     * WorkManager auf Abruf statt beim Start, das Gegenstück zum tools:node="remove"
     * im Manifest: Ohne diese Schnittstelle wirft der erste Zugriff „WorkManager is
     * not initialized properly“. Die Fabrik von Hilt baut die @HiltWorker.
     */
    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(workerFactory).build()

    override fun onCreate() {
        super.onCreate()
        // Im Render-Prozess (ui/pdf/PdfRenderDienst) gibt es weder Dateien noch Konto.
        if (Process.isIsolated()) return
        // Sitzung und Ausgang starten mit der ersten MainActivity und leben dann so lange
        // wie der Prozess, nicht wie ein ViewModel; ein Worker allein (Preisalarm) weckt sie nicht.
        registerActivityLifecycleCallbacks(AtFirstUi {
            sessionLazy.get().starte()
            ausgangsmelderLazy.get().starte(areas.application)
        })

        // Ein Token früherer Fassungen unter dem schwächeren Schlüssel kommt gleich nach dem
        // Entsperren unter den strengen, nicht erst beim nächsten Start. Das Widget zeichnet neu:
        // Gesperrt konnte es seine Zahlen nicht lesen (DevicesStore.widgetStatus).
        ContextCompat.registerReceiver(this, object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                areas.application.launch { fangeAusserAbbruch { tokenuebernahme.levelTokenHigh() } }
                areas.application.launch { fangeAusserAbbruch { SammlungsWidget().updateAll(context) } }
            }
        }, IntentFilter(Intent.ACTION_USER_PRESENT), ContextCompat.RECEIVER_NOT_EXPORTED)

        // Aufräumen im Hintergrund; ein Klartext-Token älterer Fassungen gilt nie, es geht nur weg.
        areas.application.launch {
            // Gutschein-PDFs eines abgebrochenen Laufs: Das Verlassen des Betrachters kam nie.
            fangeAusserAbbruch { raeumeVertraulichePdfsAuf(cacheDir) }
            // Anleitungen älterer Fassungen lagen im Klartext; neu liegen sie verschlüsselt.
            fangeAusserAbbruch { raeumeKlartextAnleitungenAuf(cacheDir) }
            // Bild-Zwischenspeicher älterer Fassungen (Klartext) und eine abgelaufene Teileliste.
            fangeAusserAbbruch { cleanPlaintextImageCachesOn(cacheDir) }
            fangeAusserAbbruch { cleanOldPartListOn(filesDir, System.currentTimeMillis()) }
            fangeAusserAbbruch { tokenuebernahme.adoptOldToken() }
            // Den Preisalarm-Abruf wieder einplanen: Zurückgesetzte App-Daten oder ein
            // „Force Stop“ verwerfen die Aufträge, der Schalter stünde sonst auf „an“
            // ohne Wirkung. KEEP lässt einen eingeplanten Auftrag unverändert.
            fangeAusserAbbruch {
                if (alerts.alarmMessagesAn.first()) {
                    PreisalarmWorker
                        .einplanen(this@BrickInventoryApp, true)
                        ?.let { Protokoll.warnung("Preisalarm", "Abruf nicht eingeplant", it) }
                }
            }
        }
        // Unter Android 13 setzt die App ihre Sprache selbst, vor der ersten Activity.
        // Aus dem synchronen Spiegel statt per runBlocking aus dem DataStore; fehlt er
        // (gespeichert vor dem Spiegel), einmal nachziehen — AppCompat erneuert dann die
        // Activity. Ab 13 merkt sich das System die Sprache selbst.
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

/** Ruft [los] einmal, wenn die erste MainActivity entsteht; andere Activities zählen nicht. */
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
