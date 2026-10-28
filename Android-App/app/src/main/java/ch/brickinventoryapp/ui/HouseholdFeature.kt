package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.ScopeFilter
import ch.brickinventoryapp.data.model.HouseholdMember
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Haushalt: Kontofilter je Ansicht, Mitgliederliste, Verknüpfen und
 * Verschieben.
 *
 * ── Was hier NICHT entschieden wird ─────────────────────────────────────────
 * Wer zum Haushalt gehört, wer schreiben darf und was ein Filterwert bedeutet
 * — all das beantwortet der Server (utils/household.ts). Die App reicht den
 * Wert als `accounts=` durch und zeigt, was zurückkommt. Eine zweite Fassung
 * dieser Regeln hier wäre genau die Doppelung, an der in diesem Projekt schon
 * mehrere Zahlen auseinandergelaufen sind.
 */

/** Filterwert einer Ansicht — für die Anfrage aufbereitet (null = alle). */
internal fun MainViewModel.scopeFor(view: ScopeFilter.View): String? = blickfeldDienst.kontoFuer(view)

/** Der gewaehlte Lagerort als Anfrageparameter — null, solange nicht gefiltert wird. */
internal fun MainViewModel.lagerFor(view: ScopeFilter.View): String? = blickfeldDienst.lagerFuer(view)

/**
 * Die belegten Lagerorte holen.
 *
 * Eine Abfrage fuer beide Ansichten: Die Liste spannt Sets UND Teile (siehe
 * utils/lagerort.ts). Sie je Reiter zu holen hiesse, dass Galerie und Teile
 * kurzzeitig zwei Staende zeigen.
 */
internal fun MainViewModel.loadLagerorte() {
    viewModelScope.launch { blickfeldDienst.ladeLagerorte() }
}

/**
 * Den VORRAT fuer ein Detail holen — die Orte des BESITZERS.
 *
 * ── Marcos Festlegung ───────────────────────────────────────────────────────
 *
 * „Der Grossvater soll die Werte der Enkel fuer die entsprechenden Sets sehen
 * und waehlen koennen."
 *
 * Ein Lagerort ist ein Regal in einer Wohnung. Beim Set des Enkels gehoeren
 * die Regale des ENKELS zur Wahl — ein Set des Enkels in „Grossvaters Keller"
 * waere eine Aussage ueber die falsche Wohnung.
 *
 * Ohne Besitzer (Einzelkonto) bleibt der Parameter leer, und der Server
 * antwortet mit der eigenen Liste. Genau das ist dann auch richtig.
 */
internal fun MainViewModel.loadLagerortVorrat(besitzer: List<Int>) {
    viewModelScope.launch { blickfeldDienst.ladeVorrat(besitzer) }
}

/**
 * Die EIGENEN Orte — fuer die Verwaltung in den Einstellungen.
 *
 * Und MIT ihnen die Vorgabe (Marcos Stern): Sie steht in derselben Antwort.
 * Ein zweiter Abruf dafuer koennte sich mit diesem ueberholen — dann stuende
 * der Stern einen Moment am falschen Eintrag.
 */
internal fun MainViewModel.ladeEigeneLagerorte() {
    viewModelScope.launch { blickfeldDienst.ladeEigeneLagerorte() }
}









/** Gespeicherte Filterwerte beim Start einlesen. */
internal fun MainViewModel.loadScopeModes() {
    viewModelScope.launch { blickfeldDienst.ladeFilter() }
}

/**
 * Mitglieder des Haushalts laden.
 *
 * Dieselbe Antwort entscheidet über drei Dinge: ob der Kontofilter überhaupt
 * erscheint, welche Einträge er hat und welche Konten beim Erfassen und
 * Verschieben zur Wahl stehen. Mehr als ein Eintrag heisst: Hauptkonto mit
 * Unterkonten.
 */
internal fun MainViewModel.loadHouseholdMembers() {
    viewModelScope.launch { blickfeldDienst.ladeMitglieder() }
}





