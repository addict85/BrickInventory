package ch.brickinventoryapp.sammlung.ui

import ch.brickinventoryapp.model.ui.model.*
import ch.brickinventoryapp.data.repository.MERKLISTE_DEFAULT_SORT
import ch.brickinventoryapp.ui.Fehlerklasse

/**
 * Die Merkliste — was man haben möchte, getrennt vom Besitz. Eigener Zustand statt
 * eines Felds in AppUiState: Er ändert sich nur auf diesem Bildschirm, und ein
 * Feld im Haupt-Zustand rekomponierte bei jedem Laden den ganzen Baum.
 */
data class MerklisteUiState(
    val merkposten: List<MerkpostenAnsicht> = emptyList(),
    val laedt: Boolean = false,
    /** Der Grund, warum die Liste nicht kam; null, solange nichts scheiterte. */
    val fehler: String? = null,
    val fehlerKlasse: Fehlerklasse? = null,
    // Drei Werte hier; der vierte, der Inhaber, steht wie in jeder Ansicht in
    // AppUiState.scopeModes — dieselbe Wahl unter demselben Schlüssel wie in Galerie, Teilen,
    // Minifiguren und Finanzen.
    // Ausführlich: docs/begruendungen/feature-sammlung/sammlung/ui/ZustandMerkliste.kt.md#z16
    /** Suchtext — trifft Nummer UND Name. Leer heisst: kein Filter. */
    val query: String = "",
    /** "N", "U" — oder leer fuer beide Zustaende. */
    val zustandFilter: String = "",
    val sortierung: String = MERKLISTE_DEFAULT_SORT,
)

/**
 * Was das Detail eines Merkpostens zusätzlich braucht — eigener Zustand wie beim
 * Set-Detail, weil er sich nur ändert, solange genau ein Detail offen ist. Der
 * Merkposten selbst steht nicht hier: Er liegt in der geladenen Liste, eine zweite
 * Kopie liefe beim Löschen oder Übernehmen auseinander.
 */
data class MerkpostenDetailUiState(
    /**
     * Welches Set dieses Detail zeigt — gesetzt, sobald geladen wird, vor jeder Antwort.
     * Daran erkennt setzePreisalarm(), dass der Bildschirm offen ist und die Alarme
     * nachgeladen werden dürfen; das Merkposten-Detail lädt kein SetDetail, an dem es sonst
     * zu sehen wäre.
     * Ausführlich: docs/begruendungen/feature-sammlung/sammlung/ui/ZustandMerkliste.kt.md#setnumber
     */
    val setNumber: String? = null,
    /** Thema, Teile, Minifiguren, BrickLink, Preisvergleich. */
    val katalog: KatalogDetailAnsicht? = null,
    /** Der VERLAUF. Die aktuellen Preise stehen in [preise] — siehe dort. */
    val historie: PreisverlaufAnsicht? = null,
    /**
     * Die aktuellen Marktpreise, frisch geholt. Getrennt von [historie], weil sie aus
     * einer anderen Quelle kommen und früher da sind: Der Verlauf liest nur
     * price_cache, diese Antwort füllt ihn — so stehen die Preise sofort da.
     */
    val preise: MerkpostenPreiseAnsicht? = null,
    val laedt: Boolean = false,
    /** Die Preisalarme dieses Sets — dieselben wie im Set-Detail. */
    val preisalarme: List<PreisalarmAnsicht> = emptyList(),
)
