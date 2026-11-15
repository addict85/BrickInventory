package ch.brickinventoryapp.sammlung.ui

import ch.brickinventoryapp.model.fach.Merksortierung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.fach.KatalogDetailAnsicht
import ch.brickinventoryapp.model.fach.MerkpostenAnsicht
import ch.brickinventoryapp.model.fach.MerkpostenPreiseAnsicht
import ch.brickinventoryapp.model.fach.PreisalarmAnsicht
import ch.brickinventoryapp.model.fach.PreisverlaufAnsicht
import ch.brickinventoryapp.model.ui.Laden

/**
 * Die Merkliste — was man haben möchte, getrennt vom Besitz. Eigener Zustand statt
 * eines Felds in AppUiState: Er ändert sich nur auf diesem Bildschirm, und ein
 * Feld im Haupt-Zustand rekomponierte bei jedem Laden den ganzen Baum.
 */
data class MerklisteUiState(
    val merkposten: List<MerkpostenAnsicht> = emptyList(),
    /** Der letzte Abruf vom Server; die Liste selbst kommt aus der Ablage. */
    val abruf: Laden<Unit> = Laden.Daten(Unit),
    // Drei Werte hier; der vierte, der Inhaber, steht wie in jeder Ansicht in
    // AppUiState.scopeModes — dieselbe Wahl unter demselben Schlüssel wie in Galerie, Teilen,
    // Minifiguren und Finanzen.
    /** Suchtext — trifft Nummer UND Name. Leer heisst: kein Filter. */
    val query: String = "",
    /** null: beide Zustände. */
    val zustandFilter: Zustand? = null,
    val sortierung: Merksortierung = Merksortierung.VORGABE,
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
    val abruf: Laden<Unit> = Laden.Daten(Unit),
    /** Die Preisalarme dieses Sets — dieselben wie im Set-Detail. */
    val preisalarme: List<PreisalarmAnsicht> = emptyList(),
)
