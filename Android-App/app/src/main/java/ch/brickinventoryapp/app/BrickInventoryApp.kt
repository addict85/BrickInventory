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
import ch.brickinventoryapp.dienste.alarm.PreisalarmWorker
import androidx.hilt.work.HiltWorkerFactory
import ch.brickinventoryapp.data.Alarmablage
import ch.brickinventoryapp.data.Sprachablage
import ch.brickinventoryapp.data.Tokenuebernahme
import ch.brickinventoryapp.data.di.Anwendungsbereiche
import ch.brickinventoryapp.zustand.ui.Ausgangsmelder
import ch.brickinventoryapp.sitzung.SitzungsRepository
import ch.brickinventoryapp.data.util.LanguageManager
import ch.brickinventoryapp.netz.util.Protokoll
import ch.brickinventoryapp.data.util.raeumeAlteTeilelisteAuf
import ch.brickinventoryapp.data.util.raeumeKlartextAnleitungenAuf
import ch.brickinventoryapp.sicherheit.raeumeKlartextBildcachesAuf
import ch.brickinventoryapp.data.util.raeumeVertraulichePdfsAuf
import android.os.Build
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.core.content.ContextCompat

@HiltAndroidApp
class BrickInventoryApp : Application(), Configuration.Provider {
    // Lazy: Der isolierte PDF-Prozess erzeugt auch eine Application, darf aber keine Dateien öffnen.
    @Inject lateinit var tokenuebernahmeLazy: dagger.Lazy<Tokenuebernahme>
    @Inject lateinit var alarmeLazy: dagger.Lazy<Alarmablage>
    @Inject lateinit var spracheLazy: dagger.Lazy<Sprachablage>
    private val tokenuebernahme get() = tokenuebernahmeLazy.get()
    private val alarme get() = alarmeLazy.get()
    private val sprache get() = spracheLazy.get()
    @Inject lateinit var bereiche: Anwendungsbereiche
    @Inject lateinit var workerFabrik: HiltWorkerFactory
    @Inject lateinit var sitzungLazy: dagger.Lazy<SitzungsRepository>
    @Inject lateinit var ausgangsmelderLazy: dagger.Lazy<Ausgangsmelder>

    /**
     * WorkManager auf Abruf statt beim Start, das Gegenstück zum tools:node="remove"
     * im Manifest: Ohne diese Schnittstelle wirft der erste Zugriff „WorkManager is
     * not initialized properly“. Die Fabrik von Hilt baut die @HiltWorker.
     */
    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(workerFabrik).build()

    override fun onCreate() {
        super.onCreate()
        // Im Render-Prozess (ui/pdf/PdfRenderDienst) gibt es weder Dateien noch Konto.
        if (Process.isIsolated()) return
        // Sitzung und Ausgang starten mit der ersten MainActivity und leben dann so lange
        // wie der Prozess, nicht wie ein ViewModel; ein Worker allein (Preisalarm) weckt sie nicht.
        registerActivityLifecycleCallbacks(BeiErsterOberflaeche {
            sitzungLazy.get().starte()
            ausgangsmelderLazy.get().starte(bereiche.anwendung)
        })

        // Ein Token, das bei gesperrtem Gerät unter dem schwächeren Schlüssel landete (Tausch im
        // Hintergrund), kommt gleich nach dem Entsperren unter den strengen, nicht erst beim nächsten Start.
        ContextCompat.registerReceiver(this, object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                bereiche.anwendung.launch { fangeAusserAbbruch { tokenuebernahme.stufeTokenHoch() } }
            }
        }, IntentFilter(Intent.ACTION_USER_PRESENT), ContextCompat.RECEIVER_NOT_EXPORTED)

        // Aufräumen im Hintergrund; ein Klartext-Token älterer Fassungen gilt nie, es geht nur weg.
        bereiche.anwendung.launch {
            // Gutschein-PDFs eines abgebrochenen Laufs: Das Verlassen des Betrachters kam nie.
            fangeAusserAbbruch { raeumeVertraulichePdfsAuf(cacheDir) }
            // Anleitungen älterer Fassungen lagen im Klartext; neu liegen sie verschlüsselt.
            fangeAusserAbbruch { raeumeKlartextAnleitungenAuf(cacheDir) }
            // Bild-Zwischenspeicher älterer Fassungen (Klartext) und eine abgelaufene Teileliste.
            fangeAusserAbbruch { raeumeKlartextBildcachesAuf(cacheDir) }
            fangeAusserAbbruch { raeumeAlteTeilelisteAuf(filesDir, System.currentTimeMillis()) }
            fangeAusserAbbruch { tokenuebernahme.uebernehmeAltesToken() }
            // Den Preisalarm-Abruf wieder einplanen: Zurückgesetzte App-Daten oder ein
            // „Force Stop“ verwerfen die Aufträge, der Schalter stünde sonst auf „an“
            // ohne Wirkung. KEEP lässt einen eingeplanten Auftrag unverändert.
            fangeAusserAbbruch {
                if (alarme.alarmMeldungenAn.first()) {
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
            val gemerkt = sprache.gemerkteSprache()
            if (gemerkt != null) {
                LanguageManager.applyLanguage(gemerkt)
            } else {
                bereiche.anwendung.launch(bereiche.haupt) {
                    val lang = fangeAusserAbbruch { sprache.spracheNachziehen() }.getOrNull() ?: return@launch
                    LanguageManager.applyLanguage(lang)
                }
            }
        }
    }
}

/** Ruft [los] einmal, wenn die erste MainActivity entsteht; andere Activities zählen nicht. */
private class BeiErsterOberflaeche(private val los: () -> Unit) : Application.ActivityLifecycleCallbacks {
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
