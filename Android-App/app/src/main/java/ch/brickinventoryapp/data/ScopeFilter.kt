package ch.brickinventoryapp.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import ch.brickinventoryapp.data.model.HouseholdMember
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * Kontofilter des Haushalts, je Ansicht wie in der Webapp: In der Galerie den
 * Haushalt, in den Finanzen die eigenen Zahlen. Auf dem Gerät, weil es eine
 * Ansichtseinstellung ist. Werte: "all" (Vorgabe), "own", "subs" oder die ID eines
 * Kontos; übersetzt nur auf dem Server (scopeIds in utils/household.ts). Eine
 * fremde ID weist er ab — der Filter ist eine Ansichtshilfe, kein Zugriffsweg.
 */
object ScopeFilter {

    /**
     * Die Ansichten mit eigenem Filter. Die Schlüssel heissen wie in der Webapp
     * (js/14-scope.js), damit beide dieselbe Wahl unter demselben Namen speichern.
     */
    enum class View(val key: String) {
        GALLERY("gallery"), PARTS("parts"), MINIFIGS("minifigs"), FINANCE("finance"),
        MERKLISTE("merkliste")
    }

    const val ALL = "all"

    private fun prefKey(view: View) = stringPreferencesKey("scope_${view.key}")

    fun flow(context: Context, view: View): Flow<String> =
        context.dataStore.data.map { it[prefKey(view)] ?: ALL }

    suspend fun set(context: Context, view: View, value: String) {
        context.dataStore.edit { it[prefKey(view)] = value }
    }

    /**
     * Kontofilter aller Ansichten bei jeder Anmeldung zurücksetzen: Ein überlebender
     * Filter auf ein einzelnes Konto sähe nach dem Login aus, als sei die halbe
     * Sammlung verschwunden. Innerhalb einer Sitzung bleibt die Wahl — wie in der
     * Webapp.
     */
    suspend fun resetAll(context: Context) {
        context.dataStore.edit { prefs ->
            for (view in View.values()) {
                prefs.remove(prefKey(view))
                // Der Lagerortfilter haengt an derselben Begruendung und wird
                // deshalb hier mit zurueckgesetzt — nicht in einem zweiten
                // Aufruf, den jemand vergisst.
                prefs.remove(lagerKey(view))
            }
        }
    }

    /**
     * Wert für die Anfrage, `null` solange nicht gefiltert wird: Das hält die Adressen
     * kurz und trifft im Repository den Zweig, der in der Ablage zwischenspeichert —
     * eine gefilterte Sicht darf dort nicht unter dem Schlüssel der vollen landen.
     */
    fun asQuery(value: String?): String? =
        if (value.isNullOrBlank() || value == ALL) null else value

    /**
     * Die Einträge der Auswahl: Alle Konten, Eigene, dann jedes Unterkonto namentlich
     * — jeder Nachfahre, eingerückt nach Stufe wie in der Webapp, und ein Eintrag
     * meint immer genau ein Konto. Der Server versteht `accounts=subs` weiter, für
     * ältere Fassungen der App.
     *
     * @return Paare aus (Wert, Beschriftung); leer, wenn es nichts zu wählen gibt —
     *         dann bleibt die Auswahl verborgen.
     */
    fun options(
        members: List<HouseholdMember>,
        labelAll: String, labelOwn: String,
    ): List<Pair<String, String>> {
        if (members.size < 2) return emptyList()
        val subs = members.filter { !it.isSelf }
        return buildList {
            add(ALL to labelAll)
            add("own" to labelOwn)
            subs.forEach { add(it.id.toString() to it.username) }
        }
    }

    // ═══ Lagerortfilter — je Ansicht, wie der Kontofilter ═══
    //
    // In dieser Datei, weil er derselbe Gegenstand ist und dieselben Regeln teilt:
    // gefiltert am Server, zurückgesetzt beim Anmelden. Wie in public/js/14-scope.js.

    /** Ansichten mit einem Lagerortfilter. Nur Sets und Teile haben einen. */
    private fun lagerKey(view: View) = stringPreferencesKey("lager_${view.key}")

    /** Leerer Text = nicht gefiltert. */
    fun lagerFlow(context: Context, view: View): Flow<String> =
        context.dataStore.data.map { it[lagerKey(view)] ?: "" }

    suspend fun setLager(context: Context, view: View, value: String) {
        context.dataStore.edit {
            if (value.isBlank()) it.remove(lagerKey(view)) else it[lagerKey(view)] = value
        }
    }

    /**
     * Wert für die Anfrage, `null` solange nicht gefiltert wird. Kein Sonderwert „ohne
     * Lagerort“: „Was muss ich noch einräumen?“ ist eine andere Frage als „wo liegt
     * X?“ — wie in der Webapp.
     */
    fun lagerAsQuery(value: String?): String? =
        if (value.isNullOrBlank()) null else value

    /**
     * Zeigt eine gespeicherte Wahl auf ein entkoppeltes Konto, fällt sie auf „Alle“
     * zurück — sonst stünde ein leerer Eintrag da und die Liste bliebe unerklärlich
     * gefiltert.
     */
    fun sanitize(value: String, options: List<Pair<String, String>>): String =
        if (options.any { it.first == value }) value else ALL
}
