package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.model.*

/**
 * Die Merkliste — was man haben MOECHTE, getrennt vom Besitz.
 *
 * Eigener Zustand und nicht ein Feld in AppUiState: Er aendert sich nur auf
 * diesem einen Bildschirm, und ein Feld im Haupt-Zustand rekomponierte bei
 * jedem Laden den ganzen Baum — dieselbe Begruendung wie bei der Snackbar und
 * beim Set-Detail.
 */
data class MerklisteUiState(
    val merkposten: List<ch.brickinventoryapp.data.model.Merkposten> = emptyList(),
    val laedt: Boolean = false,
    // ── Der Filter (Marcos Vorgabe vom 24.09.) ──────────────────────────────
    //
    // „In der Merkliste noch einen Filter analog den Sets einbauen inkl.
    // Inhaber." Drei Werte hier, der vierte — der INHABER — steht wie in jeder
    // anderen Ansicht in AppUiState.scopeModes; er ist dieselbe Wahl unter
    // demselben Schluessel wie in Galerie, Teilen, Minifiguren und Finanzen.
    //
    // Angewandt werden alle vier am SERVER: Die Sortierung nach Marktpreis
    // braucht price_cache, und den kennt die App nicht. So zeigen beide
    // Oberflaechen dasselbe Ergebnis.
    /** Suchtext — trifft Nummer UND Name. Leer heisst: kein Filter. */
    val query: String = "",
    /** "N", "U" — oder leer fuer beide Zustaende. */
    val zustandFilter: String = "",
    val sortierung: String = ch.brickinventoryapp.data.repository.MERKLISTE_DEFAULT_SORT,
)

/**
 * Was das Detail EINES Merkpostens zusaetzlich braucht.
 *
 * Eigener Zustand wie beim Set-Detail (_setDetailState) und aus demselben
 * Grund: Er aendert sich nur, solange genau ein Detail offen ist.
 *
 * Der Merkposten selbst steht NICHT hier — er liegt in der geladenen Liste, und
 * eine zweite Kopie liefe beim Loeschen oder Uebernehmen auseinander.
 */
data class MerkpostenDetailUiState(
    /**
     * Welches Set dieses Detail zeigt.
     *
     * Gesetzt, SOBALD geladen wird — vor jeder Antwort. Daran erkennt
     * setzePreisalarm(), dass der Bildschirm noch offen ist und die Alarme
     * nachgeladen werden duerfen. Vorher fragte die Stelle nur
     * _setDetailState.setDetail ab; das Merkposten-Detail laedt aber gar kein
     * SetDetail, also traf die Bedingung dort NIE zu. Der Alarm wurde
     * gespeichert, die Anzeige erfuhr es nur nicht — aus Marcos Sicht war er
     * damit nicht gespeichert.
     *
     * Nicht `katalog?.setNumber`: Ein Set, das rb_sets nicht kennt, hat
     * keinen Katalogeintrag, und gerade dort waere die Anzeige dann stumm.
     */
    val setNumber: String? = null,
    /** Thema, Teile, Minifiguren, BrickLink, Preisvergleich. */
    val katalog: ch.brickinventoryapp.data.model.CatalogSetDetail? = null,
    /** Der VERLAUF. Die aktuellen Preise stehen in [preise] — siehe dort. */
    val historie: ch.brickinventoryapp.data.model.PriceHistoryResponse? = null,
    /**
     * Die aktuellen Marktpreise, frisch geholt.
     *
     * Getrennt von [historie], weil sie aus einer anderen Quelle kommen und
     * frueher da sind: Der Verlauf LIEST nur price_cache, diese Antwort FUELLT
     * ihn. Marcos Frage „wieso werden die Preise nicht sofort angezeigt" hatte
     * genau hier ihre Ursache.
     */
    val preise: ch.brickinventoryapp.data.model.MerkpostenPreiseResponse? = null,
    val laedt: Boolean = false,
    /** Die Preisalarme dieses Sets — dieselben wie im Set-Detail. */
    val preisalarme: List<ch.brickinventoryapp.data.model.Preisalarm> = emptyList(),
)

// Hier standen `eingabe`, `zustand` und `notiz` — der Zustand des
// Erfassungskastens, den es nicht mehr gibt. Seit die Erfassung ein Dialog
// ist (Marcos „gleich wie bei den Sets"), haelt sie ihren Zustand selbst,
// genau wie AddSetDialog. Drei Felder im geteilten Zustand, die niemand mehr
// liest, waeren die naechste Stelle, an der jemand raetselt, wozu sie da
// sind.
