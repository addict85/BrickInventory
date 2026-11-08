package ch.brickinventoryapp.ui

import ch.brickinventoryapp.model.ui.model.MitgliedAnsicht
import ch.brickinventoryapp.ui.util.NumericInput

/**
 * Die vier Eingaben, wie der Server sie braucht — eine Umrechnung für beide
 * Dialoge: Eine leere Anzahl heisst eins, der Preis wird wie in der Web-App gelesen
 * (NumericInput.leseBetrag), und ohne Haushalt geht kein Besitzer mit, damit der
 * Server beim eigenen Konto bleibt. Eine unlesbare Eingabe wird hier nicht still zu
 * eins oder „kein Preis": Wer speichert, fragt vorher [erfassungUngueltig].
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
    preis = NumericInput.leseBetrag(preis),
    zustand = zustand,
    besitzer = if (haushalt.size > 1) besitzer else null,
)

/** Ob Anzahl oder Preis etwas Unlesbares tragen; dann speichert der Dialog nicht, und das Feld sagt warum. */
fun erfassungUngueltig(anzahl: String, preis: String): Boolean =
    NumericInput.mengeUngueltig(anzahl) || NumericInput.preisUngueltig(preis)
