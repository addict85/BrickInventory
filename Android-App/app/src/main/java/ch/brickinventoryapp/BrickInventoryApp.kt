package ch.brickinventoryapp

import android.app.Application
import androidx.work.Configuration
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

@HiltAndroidApp
class BrickInventoryApp : Application(), Configuration.Provider {
    @Inject lateinit var preferencesManager: ch.brickinventoryapp.data.PreferencesManager

    /**
     * WorkManager auf Abruf statt beim Start — das Gegenstück zum tools:node="remove"
     * im Manifest: Ohne den androidx.startup-Eintrag fährt WorkManager erst beim
     * ersten WorkManager.getInstance() hoch und holt seine Einstellungen hier. Fehlt
     * diese Schnittstelle, wirft genau dieser Zugriff „WorkManager is not initialized
     * properly“ — die beiden Änderungen gehören zusammen. Die Vorgaben genügen: Der
     * einzige Auftrag ist ein stündlicher Abruf ohne eigene WorkerFactory (siehe
     * PreisalarmWorker). Ausführlich am Manifest-Eintrag.
     */
    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().build()

    override fun onCreate() {
        super.onCreate()

        // ── Klartext-Token einmalig übernehmen ──
        //
        // Auf Geräten mit älterer Fassung liegt das Bearer-Token unverschlüsselt im
        // DataStore; hier wird es verschlüsselt neu abgelegt und der Klartext entfernt. Im
        // Hintergrund, nicht blockierend: Der Lesepfad kommt auch ohne Übernahme an das
        // alte Token (PreferencesManager.authToken), der Kaltstart soll nicht warten.
        // Läuft sie nicht durch, passiert sie beim nächsten Start.
        kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch {
            runCatching { preferencesManager.uebernehmeAltesToken() }
            // ── Den Preisalarm-Abruf wieder einplanen ──
            //
            // WorkManager überlebt Neustarts, aber nicht ein Zurücksetzen der App-Daten, eine
            // Neuinstallation über ein Backup oder ein „Force Stop“, nach dem manche
            // Hersteller die Aufträge verwerfen. Dann stünde der Schalter auf „an“ und es käme
            // nie wieder eine Meldung. KEEP (siehe einplanen()) lässt einen eingeplanten
            // Auftrag unverändert, statt ihn bei jedem Start nach hinten zu schieben.
            // runCatching umschliesst nur das Lesen der Einstellung; einplanen() fängt selbst.
            runCatching {
                if (preferencesManager.alarmMeldungenAn.first()) {
                    ch.brickinventoryapp.alarm.PreisalarmWorker
                        .einplanen(this@BrickInventoryApp, true)
                        ?.let { android.util.Log.w("Preisalarm", "Abruf nicht eingeplant", it) }
                }
            }
        }
        // Unter Android 13 setzt die App ihre Sprache selbst, vor der ersten Activity.
        // Aus dem synchronen Spiegel statt per runBlocking aus dem DataStore; fehlt er
        // (gespeichert vor dem Spiegel), einmal nachziehen — AppCompat erneuert dann die
        // Activity. Ab 13 merkt sich das System die Sprache selbst.
        if (android.os.Build.VERSION.SDK_INT < 33) {
            val gemerkt = preferencesManager.gemerkteSprache()
            if (gemerkt != null) {
                ch.brickinventoryapp.util.LanguageManager.applyLanguage(gemerkt)
            } else {
                kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Main).launch {
                    val lang = runCatching { preferencesManager.spracheNachziehen() }.getOrNull() ?: return@launch
                    ch.brickinventoryapp.util.LanguageManager.applyLanguage(lang)
                }
            }
        }
    }
}

