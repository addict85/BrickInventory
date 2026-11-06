package ch.brickinventoryapp.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject

/**
 * Wo die Wahl des Konto- und Lagerortfilters liegt: im DataStore des Geräts. Getrennt
 * von [ScopeFilter], damit die Regeln dort ohne Android auskommen und die Oberfläche
 * sie lesen kann, ohne die Ablage zu kennen.
 */
class ScopeFilterSpeicher @Inject constructor(private val dataStore: DataStore<Preferences>) {

    private fun prefKey(view: ScopeFilter.View) = stringPreferencesKey("scope_${view.key}")

    fun flow(view: ScopeFilter.View): Flow<String> =
        dataStore.data.map { it[prefKey(view)] ?: ScopeFilter.ALL }

    suspend fun set(view: ScopeFilter.View, value: String) {
        dataStore.edit { it[prefKey(view)] = value }
    }

    /**
     * Kontofilter aller Ansichten bei jeder Anmeldung zurücksetzen: Ein überlebender
     * Filter auf ein einzelnes Konto sähe nach dem Login aus, als sei die halbe
     * Sammlung verschwunden. Innerhalb einer Sitzung bleibt die Wahl — wie in der
     * Webapp.
     */
    suspend fun resetAll() {
        dataStore.edit { prefs ->
            for (view in ScopeFilter.View.values()) {
                prefs.remove(prefKey(view))
                // Der Lagerortfilter haengt an derselben Begruendung und wird
                // deshalb hier mit zurueckgesetzt — nicht in einem zweiten
                // Aufruf, den jemand vergisst.
                prefs.remove(lagerKey(view))
            }
        }
    }

    // ═══ Lagerortfilter — je Ansicht, wie der Kontofilter ═══
    //
    // In dieser Datei, weil er derselbe Gegenstand ist und dieselben Regeln teilt:
    // gefiltert am Server, zurückgesetzt beim Anmelden. Wie in public/js/14-scope.js.

    /** Ansichten mit einem Lagerortfilter. Nur Sets und Teile haben einen. */
    private fun lagerKey(view: ScopeFilter.View) = stringPreferencesKey("lager_${view.key}")

    /** Leerer Text = nicht gefiltert. */
    fun lagerFlow(view: ScopeFilter.View): Flow<String> =
        dataStore.data.map { it[lagerKey(view)] ?: "" }

    suspend fun setLager(view: ScopeFilter.View, value: String) {
        dataStore.edit {
            if (value.isBlank()) it.remove(lagerKey(view)) else it[lagerKey(view)] = value
        }
    }
}
