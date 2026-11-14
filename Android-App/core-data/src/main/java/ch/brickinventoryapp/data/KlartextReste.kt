package ch.brickinventoryapp.data

import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey

/**
 * Was die abgeschaffte Klartext-Erlaubnis auf dem Gerät hinterliess. Gelesen wird
 * es nicht mehr; es geht weg, damit keine alte Freigabe für Hosts und Netze liegen
 * bleibt, die ein späterer Stand versehentlich wieder auswerten könnte. Ebenso die
 * Konto- und Lagerortfilter früherer Fassungen: Sie nannten Konten und Orte im Klartext
 * und leben jetzt nur im Speicher (ScopeFilterSpeicher).
 */
internal object KlartextReste {
    /** Im DataStore: freigegebene Hosts, bekannte Netze, die Übernahmemarke. */
    private val DATASTORE = listOf(
        stringSetPreferencesKey("klartext_hosts"),
        stringSetPreferencesKey("klartext_netze"),
        booleanPreferencesKey("klartext_alt_uebernommen"),
    )

    /** Im Spiegel (SharedPreferences): der Expertenschalter und seine Übernahmemarke. */
    val SPIEGEL = listOf("klartext_experte", "klartext_experte_uebernommen")

    /** Die Namen beginnen mit der Ansicht (ScopeFilter.View.key); die Werte waren immer Text. */
    private val FILTER = listOf("scope_", "lager_")

    fun entferne(prefs: MutablePreferences) {
        DATASTORE.forEach { prefs.remove(it) }
        prefs.asMap().keys.map { it.name }.filter { n -> FILTER.any(n::startsWith) }
            .forEach { prefs.remove(stringPreferencesKey(it)) }
    }
}
