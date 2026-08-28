package ch.brickinventoryapp.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import ch.brickinventoryapp.data.model.HouseholdMember
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * Kontofilter des Haushalts — JE ANSICHT.
 *
 * ── Warum je Ansicht ────────────────────────────────────────────────────────
 * Wer in der Galerie den ganzen Haushalt sieht, will in den Finanzen womöglich
 * nur die eigenen Zahlen. Die Wahl gilt deshalb getrennt für Galerie, Teile,
 * Minifiguren und Finanzen — genauso wie in der Webapp.
 *
 * ── Warum auf dem Gerät und nicht auf dem Server ────────────────────────────
 * Es ist eine Ansichtseinstellung wie „Kachel oder Tabelle", keine Eigenschaft
 * des Kontos: Am Telefon will man sie womöglich anders als am Rechner. Deshalb
 * DataStore und nicht die Benutzereinstellungen.
 *
 * ── Was der Wert bedeutet ───────────────────────────────────────────────────
 * "all" (Vorgabe), "own", "subs" — oder die ID EINES Kontos des Haushalts.
 * Übersetzt wird er ausschliesslich auf dem Server (scopeIds in
 * utils/household.ts); die App reicht ihn als `accounts=` durch. Eine ID, die
 * nicht zum Haushalt gehört, weist der Server ab und zeigt das ganze Blickfeld
 * — der Filter ist eine Ansichtshilfe, kein Zugriffsweg.
 */
object ScopeFilter {

    /** Die vier Ansichten mit eigenem Filter. */
    enum class View(val key: String) {
        GALLERY("gallery"), PARTS("parts"), MINIFIGS("minifigs"), FINANCE("finance")
    }

    const val ALL = "all"

    private fun prefKey(view: View) = stringPreferencesKey("scope_${view.key}")

    fun flow(context: Context, view: View): Flow<String> =
        context.dataStore.data.map { it[prefKey(view)] ?: ALL }

    suspend fun set(context: Context, view: View, value: String) {
        context.dataStore.edit { it[prefKey(view)] = value }
    }

    /**
     * Kontofilter aller Ansichten zurücksetzen — bei jeder ANMELDUNG.
     *
     * Nachtrag 46, Marcos Wunsch: Der Filter überlebte Abmelden und Anmelden.
     * Wer zuletzt auf ein einzelnes Konto gefiltert hatte, sah nach dem
     * nächsten Login wieder nur dessen Sets, ohne Hinweis darauf — das sah
     * aus, als sei die halbe Sammlung verschwunden.
     *
     * Innerhalb einer Sitzung bleibt eine getroffene Wahl erhalten; sie wird
     * nur beim Anmelden verworfen. Dieselbe Regel wie in der Webapp.
     */
    suspend fun resetAll(context: Context) {
        context.dataStore.edit { prefs ->
            for (view in View.values()) prefs.remove(prefKey(view))
        }
    }

    /**
     * Wert für die Anfrage — `null`, solange nicht gefiltert wird.
     *
     * "all" wegzulassen hält die Adressen kurz und trifft im Repository den
     * Zweig, der die Antwort in der Ablage zwischenspeichert: Eine gefilterte
     * Sicht darf dort nicht unter demselben Schlüssel landen wie die volle.
     */
    fun asQuery(value: String?): String? =
        if (value.isNullOrBlank() || value == ALL) null else value

    /**
     * Die Einträge der Auswahl: Alle Konten, Eigene, dann JEDES Unterkonto
     * namentlich.
     *
     * Der Sammelposten „Unterkonten" ist auf Marcos Wunsch entfallen: Er
     * beantwortete nur „nicht mir" und stand zwischen zwei Einträgen, die
     * dieselbe Frage genauer beantworten.
     *
     * Der Server versteht `accounts=subs` weiterhin — eine ältere Fassung
     * dieser App auf einem Gerät schickt es sonst ins Leere.
     *
     * @return Paare aus (Wert, Beschriftung); leer, wenn es nichts zu wählen
     *         gibt (Konto ohne Unterkonten) — dann bleibt die Auswahl verborgen.
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

    /**
     * Zeigt eine gespeicherte Wahl auf ein Konto, das es nicht mehr gibt
     * (entkoppelt), fällt sie auf „Alle" zurück — sonst stünde in der Auswahl
     * ein leerer Eintrag und die Liste bliebe unerklärlich gefiltert.
     */
    fun sanitize(value: String, options: List<Pair<String, String>>): String =
        if (options.any { it.first == value }) value else ALL
}
