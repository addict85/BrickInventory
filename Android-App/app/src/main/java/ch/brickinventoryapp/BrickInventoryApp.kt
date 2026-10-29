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
     * WorkManager auf Abruf statt beim Start, das Gegenstück zum tools:node="remove"
     * im Manifest: Ohne diese Schnittstelle wirft der erste Zugriff „WorkManager is
     * not initialized properly“. Die Vorgaben genügen (PreisalarmWorker).
     */
    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().build()

    override fun onCreate() {
        super.onCreate()

        // Ein Klartext-Token älterer Fassungen einmalig verschlüsselt ablegen, im
        // Hintergrund: Der Lesepfad kommt auch ohne Übernahme an das alte Token.
        kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch {
            runCatching { preferencesManager.uebernehmeAltesToken() }
            // Den Preisalarm-Abruf wieder einplanen: Zurückgesetzte App-Daten oder ein
            // „Force Stop“ verwerfen die Aufträge, der Schalter stünde sonst auf „an“
            // ohne Wirkung. KEEP lässt einen eingeplanten Auftrag unverändert.
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

