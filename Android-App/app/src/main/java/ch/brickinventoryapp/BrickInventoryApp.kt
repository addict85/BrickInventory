package ch.brickinventoryapp

import android.app.Application
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

@HiltAndroidApp
class BrickInventoryApp : Application() {
    @Inject lateinit var preferencesManager: ch.brickinventoryapp.data.PreferencesManager

    override fun onCreate() {
        super.onCreate()

        // ── Klartext-Token einmalig übernehmen (Nachtrag 155) ────────────────
        //
        // Auf jedem Gerät, das die App vor dieser Fassung benutzt hat, liegt
        // das Bearer-Token unverschlüsselt im DataStore. Hier wird es einmal
        // verschlüsselt neu abgelegt und der Klartext entfernt.
        //
        // Im Hintergrund, NICHT blockierend: Der Lesepfad kommt auch ohne
        // Übernahme an das alte Token heran (siehe PreferencesManager.authToken),
        // die Übernahme darf den Kaltstart also nicht aufhalten. Läuft sie
        // wegen eines Absturzes nicht durch, passiert sie beim nächsten Start.
        kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch {
            runCatching { preferencesManager.uebernehmeAltesToken() }
            // ── Den Preisalarm-Abruf wieder einplanen ────────────────────────
            //
            // WorkManager ueberlebt Neustarts von sich aus. Was er NICHT
            // ueberlebt, ist ein Zuruecksetzen der App-Daten, eine
            // Neuinstallation ueber ein Backup oder ein „Force Stop", nach dem
            // manche Hersteller die Auftraege verwerfen. Dann stuende der
            // Schalter auf „an" und es kaeme nie wieder eine Meldung — ein
            // Fehler, den niemand meldet, weil nichts passiert.
            //
            // KEEP (siehe einplanen()) macht den Aufruf im Normalfall zu einem
            // Nichts: Ein bereits eingeplanter Auftrag laeuft unveraendert
            // weiter und wird nicht bei jedem Start nach hinten geschoben.
            runCatching {
                if (preferencesManager.alarmMeldungenAn.first()) {
                    ch.brickinventoryapp.alarm.PreisalarmWorker.einplanen(this@BrickInventoryApp, true)
                }
            }
        }
        // Ab Android 13 (API 33) persistiert das System die per-App-Sprache
        // selbst (LocaleManager) und wendet sie vor Activity-Start an — der
        // blockierende DataStore-Read beim Kaltstart ist dort unnötig.
        // Nur auf älteren Geräten muss die gespeicherte Sprache manuell
        // re-appliziert werden, bevor die erste Activity rendert.
        if (android.os.Build.VERSION.SDK_INT < 33) {
            kotlinx.coroutines.runBlocking {
                val lang = preferencesManager.language.first()
                ch.brickinventoryapp.util.LanguageManager.applyLanguage(lang)
            }
        }
    }
}

