package ch.brickinventoryapp

import ch.brickinventoryapp.util.fangeAusserAbbruch
import android.app.Application
import androidx.work.Configuration
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import ch.brickinventoryapp.alarm.PreisalarmWorker
import ch.brickinventoryapp.data.PreferencesManager
import ch.brickinventoryapp.di.Anwendungsbereiche
import ch.brickinventoryapp.util.LanguageManager
import ch.brickinventoryapp.util.Protokoll
import ch.brickinventoryapp.util.raeumeAlteTeilelisteAuf
import ch.brickinventoryapp.util.raeumeKlartextAnleitungenAuf
import ch.brickinventoryapp.util.raeumeKlartextBildcachesAuf
import ch.brickinventoryapp.util.raeumeVertraulichePdfsAuf

@HiltAndroidApp
class BrickInventoryApp : Application(), Configuration.Provider {
    @Inject lateinit var preferencesManager: PreferencesManager
    @Inject lateinit var bereiche: Anwendungsbereiche

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
        bereiche.anwendung.launch {
            // Gutschein-PDFs eines abgebrochenen Laufs: Das Verlassen des Betrachters kam nie.
            fangeAusserAbbruch { raeumeVertraulichePdfsAuf(cacheDir) }
            // Anleitungen älterer Fassungen lagen im Klartext; neu liegen sie verschlüsselt.
            fangeAusserAbbruch { raeumeKlartextAnleitungenAuf(cacheDir) }
            // Bild-Zwischenspeicher älterer Fassungen (Klartext) und eine abgelaufene Teileliste.
            fangeAusserAbbruch { raeumeKlartextBildcachesAuf(cacheDir) }
            fangeAusserAbbruch { raeumeAlteTeilelisteAuf(filesDir, System.currentTimeMillis()) }
            fangeAusserAbbruch { preferencesManager.uebernehmeAltesToken() }
            // Den Preisalarm-Abruf wieder einplanen: Zurückgesetzte App-Daten oder ein
            // „Force Stop“ verwerfen die Aufträge, der Schalter stünde sonst auf „an“
            // ohne Wirkung. KEEP lässt einen eingeplanten Auftrag unverändert.
            fangeAusserAbbruch {
                if (preferencesManager.alarmMeldungenAn.first()) {
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
        if (android.os.Build.VERSION.SDK_INT < 33) {
            val gemerkt = preferencesManager.gemerkteSprache()
            if (gemerkt != null) {
                LanguageManager.applyLanguage(gemerkt)
            } else {
                bereiche.anwendung.launch(bereiche.haupt) {
                    val lang = fangeAusserAbbruch { preferencesManager.spracheNachziehen() }.getOrNull() ?: return@launch
                    LanguageManager.applyLanguage(lang)
                }
            }
        }
    }
}
