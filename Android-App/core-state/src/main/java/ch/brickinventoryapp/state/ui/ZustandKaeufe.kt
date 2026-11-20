package ch.brickinventoryapp.state.ui

import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.domain.Postenart
import ch.brickinventoryapp.model.domain.KaufAnsicht
import ch.brickinventoryapp.model.domain.PurchaseSumsView
import ch.brickinventoryapp.model.domain.OHNE_FARBE
import ch.brickinventoryapp.model.domain.PriceHistoryView
/**
 * Zustand für den Detail-Dialog manuell erfasster Teile und Minifiguren.
 * Getrennt vom Haupt-State damit Acquisition-Updates (die beim Editieren
 * häufig vorkommen) nicht die gesamte App rekomponieren.
 */
data class ManualItemDetailUiState(
    val acquisitions: List<KaufAnsicht> = emptyList(),
    /** Summenzeile vom Server — siehe SetDetailUiState.acquisitionTotals. */
    val acquisitionTotals: PurchaseSumsView = PurchaseSumsView(),
    val purchasesFetch: Laden<Unit> = Laden.Daten(Unit),
    // Identifiziert das aktuell geöffnete Element
    val itemType: Postenart? = null,
    val itemId: String = "",         // part_number oder fig_number
    val colorId: Int = OHNE_FARBE,
    // Keine eigene Gesamtmenge: Die Anzeige folgt der Summe der Erfassungen.
    /** Marktpreis je Zustand und Verlauf — dieselbe Antwortform wie beim Set. */
    val priceHistory: PriceHistoryView? = null,
    val historyFetch: Laden<Unit> = Laden.Daten(Unit),
)
