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
     * WorkManager auf Abruf statt beim Start.
     *
     * Das Gegenstueck zum tools:node="remove" im Manifest: Ohne den Eintrag
     * in androidx.startup faehrt WorkManager nicht mehr von selbst hoch,
     * sondern beim ersten WorkManager.getInstance() — und holt sich seine
     * Einstellungen dann HIER.
     *
     * Fehlt diese Schnittstelle, wirft genau dieser erste Zugriff
     * "WorkManager is not initialized properly". Die beiden Aenderungen
     * gehoeren zusammen; eine allein ist ein Fehler.
     *
     * Die Vorgaben genuegen: Der einzige Auftrag ist ein stuendlicher Abruf
     * ohne eigene WorkerFactory (siehe die Begruendung fuer EntryPoint statt
     * @HiltWorker in PreisalarmWorker).
     *
     * Dass die Umstellung noetig WAR und nicht nur gut aussah, hat Marcos
     * Geraet bestaetigt: Davor startete die App nicht mehr, danach wieder.
     * Die ausfuehrliche Fassung steht am Manifest-Eintrag.
     */
    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().build()

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
            // runCatching umschliesst hier nur noch das LESEN der Einstellung:
            // einplanen() faengt seit dem 25.09. selbst (siehe dort). Zwei
            // Netze uebereinander sahen aus wie Vorsicht und waren in Wahrheit
            // der Grund, warum die zweite Aufrufstelle ohne auskam.
            runCatching {
                if (preferencesManager.alarmMeldungenAn.first()) {
                    ch.brickinventoryapp.alarm.PreisalarmWorker
                        .einplanen(this@BrickInventoryApp, true)
                        ?.let { android.util.Log.w("Preisalarm", "Abruf nicht eingeplant", it) }
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

