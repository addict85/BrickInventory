package ch.brickinventoryapp.verwaltung.ui

import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.model.ProtokollZeileAnsicht

/**
 * Das Server-Protokoll — eigener Zustand für Verwalter: Es liest genau ein
 * Bildschirm. Die Zeilen bleiben stehen, während ein anderer Zeitraum geholt wird.
 */
data class VerwaltungUiState(
    val protokoll: List<ProtokollZeileAnsicht> = emptyList(),
    /** Zeitspanne des Protokolls in Minuten — der Server begrenzt auf 2880. */
    val protokollMinuten: Int = 15,
    val abruf: Laden<Unit> = Laden.Daten(Unit),
)
