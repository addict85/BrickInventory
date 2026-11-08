package ch.brickinventoryapp.zustand.ui

import ch.brickinventoryapp.model.ui.model.*

/**
 * Zustand für den Detail-Dialog manuell erfasster Teile und Minifiguren.
 * Getrennt vom Haupt-State damit Acquisition-Updates (die beim Editieren
 * häufig vorkommen) nicht die gesamte App rekomponieren.
 */
data class ManualItemDetailUiState(
    val acquisitions: List<KaufAnsicht> = emptyList(),
    /** Summenzeile vom Server — siehe SetDetailUiState.acquisitionTotals. */
    val acquisitionTotals: KaufSummenAnsicht = KaufSummenAnsicht(),
    val isLoading: Boolean = false,
    // Identifiziert das aktuell geöffnete Element
    val itemType: String = "",       // "part" | "fig"
    val itemId: String = "",         // part_number oder fig_number
    val colorId: Int = OHNE_FARBE,
    // `newQuantity` stand hier — die Gesamtmenge nach dem Loeschen einer
    // Erfassung. Gelesen wurde sie nie, und sie wird auch nicht gebraucht: Die
    // angezeigte Menge folgt der SUMME der Erfassungen
    // (ManualItemDetailScreen), und die laedt deleteManualAcquisition()
    // unmittelbar danach neu.
    /** Marktpreis je Zustand und Verlauf — dieselbe Antwortform wie beim Set. */
    val priceHistory: PreisverlaufAnsicht? = null,
    val priceHistoryLoading: Boolean = false,
)
