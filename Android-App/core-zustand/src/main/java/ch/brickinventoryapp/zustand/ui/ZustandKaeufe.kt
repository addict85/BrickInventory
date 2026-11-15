package ch.brickinventoryapp.zustand.ui

import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.fach.Postenart
import ch.brickinventoryapp.model.ui.model.KaufAnsicht
import ch.brickinventoryapp.model.ui.model.KaufSummenAnsicht
import ch.brickinventoryapp.model.ui.model.OHNE_FARBE
import ch.brickinventoryapp.model.ui.model.PreisverlaufAnsicht
/**
 * Zustand für den Detail-Dialog manuell erfasster Teile und Minifiguren.
 * Getrennt vom Haupt-State damit Acquisition-Updates (die beim Editieren
 * häufig vorkommen) nicht die gesamte App rekomponieren.
 */
data class ManualItemDetailUiState(
    val acquisitions: List<KaufAnsicht> = emptyList(),
    /** Summenzeile vom Server — siehe SetDetailUiState.acquisitionTotals. */
    val acquisitionTotals: KaufSummenAnsicht = KaufSummenAnsicht(),
    val kaeufeAbruf: Laden<Unit> = Laden.Daten(Unit),
    // Identifiziert das aktuell geöffnete Element
    val itemType: Postenart? = null,
    val itemId: String = "",         // part_number oder fig_number
    val colorId: Int = OHNE_FARBE,
    // Keine eigene Gesamtmenge: Die Anzeige folgt der Summe der Erfassungen.
    /** Marktpreis je Zustand und Verlauf — dieselbe Antwortform wie beim Set. */
    val priceHistory: PreisverlaufAnsicht? = null,
    val verlaufAbruf: Laden<Unit> = Laden.Daten(Unit),
)
