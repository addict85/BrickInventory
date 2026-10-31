package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.model.*

/**
 * Das Server-Protokoll — eigener Zustand für Verwalter: Es liest genau ein
 * Bildschirm. Der Name bleibt, weil die Klasse trägt, was ein Verwalter in der App
 * sieht.
 */
data class VerwaltungUiState(
    val protokollLaden: Boolean = false,
    val protokoll: List<ch.brickinventoryapp.ui.model.ProtokollZeileAnsicht> = emptyList(),
    /** Zeitspanne des Protokolls in Minuten — der Server begrenzt auf 2880. */
    val protokollMinuten: Int = 15,
    val fehler: String? = null,
)
