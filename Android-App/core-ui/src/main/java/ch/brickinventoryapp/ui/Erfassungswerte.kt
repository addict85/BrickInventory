package ch.brickinventoryapp.ui

import ch.brickinventoryapp.ui.model.MitgliedAnsicht

/**
 * Die vier Eingaben, wie der Server sie braucht — eine Umrechnung für beide
 * Dialoge: Eine leere Anzahl heisst eins, das Komma der deutschen Tastatur wird
 * zum Punkt, und ohne Haushalt geht kein Besitzer mit, damit der Server beim
 * eigenen Konto bleibt.
 */
data class ErfassungsWerte(
    val anzahl: Int,
    val preis: Double?,
    val zustand: String,
    val besitzer: Int?,
)

/**
 * @param haushalt Die Konten des Haushalts — bei hoechstens einem geht KEIN
 *                 Besitzer mit.
 */
fun erfassungsWerte(
    anzahl: String,
    preis: String,
    zustand: String,
    besitzer: Int?,
    haushalt: List<MitgliedAnsicht>,
): ErfassungsWerte = ErfassungsWerte(
    anzahl = anzahl.toIntOrNull() ?: 1,
    preis = preis.replace(',', '.').toDoubleOrNull(),
    zustand = zustand,
    besitzer = if (haushalt.size > 1) besitzer else null,
)
