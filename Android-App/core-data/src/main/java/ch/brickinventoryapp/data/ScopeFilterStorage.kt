package ch.brickinventoryapp.data

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import javax.inject.Inject
import javax.inject.Singleton
import ch.brickinventoryapp.model.data.ScopeFilter

/**
 * Wo die Wahl des Konto- und Lagerortfilters liegt: nur im Speicher. Die Werte nennen Konten
 * und Lagerorte und gelten ohnehin nur bis zur nächsten Anmeldung; auf der Platte lägen sie
 * im Klartext neben der Adresse. Nach einem Prozessende gilt wieder „alle“, wie für die
 * Rollposition. Getrennt von [ScopeFilter], damit die Regeln dort ohne Android auskommen.
 */
@Singleton
class ScopeFilterStorage @Inject constructor() {

    private val werte = MutableStateFlow<Map<String, String>>(emptyMap())

    private fun prefKey(view: ScopeFilter.View) = "scope_${view.key}"

    fun flow(view: ScopeFilter.View): Flow<String> =
        werte.map { it[prefKey(view)] ?: ScopeFilter.ALL }

    fun set(view: ScopeFilter.View, value: String) {
        werte.update { it + (prefKey(view) to value) }
    }

    /**
     * Kontofilter aller Ansichten bei jeder Anmeldung zurücksetzen: Ein überlebender
     * Filter auf ein einzelnes Konto sähe nach dem Login aus, als sei die halbe
     * Sammlung verschwunden. Der Lagerortfilter gleich mit, aus demselben Grund.
     */
    fun resetAll() {
        werte.value = emptyMap()
    }

    // ═══ Lagerortfilter — je Ansicht, wie der Kontofilter (public/js/account-filter.js) ═══

    private fun storageKey(view: ScopeFilter.View) = "lager_${view.key}"

    /** Leerer Text = nicht gefiltert. */
    fun storageFlow(view: ScopeFilter.View): Flow<String> =
        werte.map { it[storageKey(view)] ?: "" }

    fun setLager(view: ScopeFilter.View, value: String) {
        werte.update { if (value.isBlank()) it - storageKey(view) else it + (storageKey(view) to value) }
    }
}
