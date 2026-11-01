package ch.brickinventoryapp.data

import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey

/**
 * Was die abgeschaffte Klartext-Erlaubnis auf dem Gerät hinterliess. Gelesen wird
 * es nicht mehr; es geht weg, damit keine alte Freigabe für Hosts und Netze liegen
 * bleibt, die ein späterer Stand versehentlich wieder auswerten könnte.
 */
object KlartextReste {
    /** Im DataStore: freigegebene Hosts, bekannte Netze, die Übernahmemarke. */
    private val DATASTORE = listOf(
        stringSetPreferencesKey("klartext_hosts"),
        stringSetPreferencesKey("klartext_netze"),
        booleanPreferencesKey("klartext_alt_uebernommen"),
    )

    /** Im Spiegel (SharedPreferences): der Expertenschalter und seine Übernahmemarke. */
    val SPIEGEL = listOf("klartext_experte", "klartext_experte_uebernommen")

    fun entferne(prefs: MutablePreferences) {
        DATASTORE.forEach { prefs.remove(it) }
    }
}
