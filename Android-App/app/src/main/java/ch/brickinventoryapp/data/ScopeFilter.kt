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

    /**
     * Die fuenf Ansichten mit eigenem Filter.
     *
     * MERKLISTE kam am 24.09. dazu — Marcos Vorgabe: „In der Merkliste noch
     * einen Filter analog den Sets einbauen inkl. Inhaber." Der Schluessel
     * heisst genau wie in der Webapp ('merkliste' in js/14-scope.js), damit
     * beide Oberflaechen dieselbe Wahl unter demselben Namen speichern.
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
     * ── Alle Stufen, eingerueckt (Nachtrag 173) ─────────────────────────────
     *
     * Die Liste enthaelt seit dem Kontenbaum JEDEN Nachfahren, nicht nur die
     * direkten Unterkonten — ein Eintrag meint dabei immer genau EIN Konto,
     * nie dessen Unterkonten mit. Ohne Einrueckung stuenden Kind und Enkel
     * gleichrangig untereinander, und die Auswahl sagte nicht mehr, wer zu
     * wem gehoert. Genau dieselbe Darstellung wie in der Webapp
     * (public/js/02-gallery.js, initScopeSelects).
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
            subs.forEach {
                val einzug = "   ".repeat((it.tiefe - 1).coerceAtLeast(0))
                add(it.id.toString() to (einzug + it.username))
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Lagerortfilter — je Ansicht, genau wie der Kontofilter
    // ═══════════════════════════════════════════════════════════════════════
    //
    // ── Warum in DIESER Datei ───────────────────────────────────────────────
    //
    // Der Lagerortfilter ist derselbe Gegenstand wie der Kontofilter: eine Wahl
    // je Ansicht, die als Anfrageparameter mitreist und am Server in die
    // Abfrage eingeht. Er teilt sogar die Begruendungen — gefiltert wird am
    // Server, weil sich die Gesamtzahl darunter nicht am Geraet aussieben
    // laesst, und die Wahl wird beim Anmelden zurueckgesetzt, weil sie sonst
    // wie eine verschwundene Sammlung aussieht.
    //
    // Genau dieselbe Entscheidung wie in der Webapp (public/js/14-scope.js):
    // Zwei Dateien fuer dieselbe Sache waeren zwei Fassungen dieser Regeln, und
    // eine davon waere irgendwann die aeltere.

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
     * Wert fuer die Anfrage — `null`, solange nicht gefiltert wird.
     *
     * Kein Sonderwert fuer „ohne Lagerort": Wer danach sucht, sucht in Wahrheit
     * „was muss ich noch einraeumen", und das ist eine andere Frage als „wo
     * liegt X". Sie bekaeme eine eigene Antwort, keinen Eintrag in diesem
     * Filter. (Dieselbe Festlegung wie in der Webapp.)
     */
    fun lagerAsQuery(value: String?): String? =
        if (value.isNullOrBlank()) null else value

    /**
     * Zeigt eine gespeicherte Wahl auf ein Konto, das es nicht mehr gibt
     * (entkoppelt), fällt sie auf „Alle" zurück — sonst stünde in der Auswahl
     * ein leerer Eintrag und die Liste bliebe unerklärlich gefiltert.
     */
    fun sanitize(value: String, options: List<Pair<String, String>>): String =
        if (options.any { it.first == value }) value else ALL
}
