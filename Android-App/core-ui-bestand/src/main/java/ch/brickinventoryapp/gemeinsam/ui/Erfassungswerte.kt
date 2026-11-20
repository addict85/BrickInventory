package ch.brickinventoryapp.gemeinsam.ui

import ch.brickinventoryapp.model.fach.Geld
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.fach.MemberView
import ch.brickinventoryapp.ui.util.NumericInput

/**
 * Die vier Eingaben, wie der Server sie braucht — eine Umrechnung für beide
 * Dialoge: Eine leere Anzahl heisst eins, der Preis wird wie in der Web-App gelesen
 * (NumericInput.readAmount), und ohne Haushalt geht kein Besitzer mit, damit der
 * Server beim eigenen Konto bleibt. Eine unlesbare Eingabe wird hier nicht still zu
 * eins oder „kein Preis": Wer speichert, fragt vorher [entryInvalid].
 */
data class EntryValues(
    val anzahl: Int,
    val preis: Geld?,
    val zustand: Zustand,
    val besitzer: Int?,
)

/**
 * @param haushalt Die Konten des Haushalts — bei hoechstens einem geht KEIN
 *                 Besitzer mit.
 */
fun erfassungsWerte(
    anzahl: String,
    preis: String,
    zustand: Zustand,
    besitzer: Int?,
    haushalt: List<MemberView>,
): EntryValues = EntryValues(
    anzahl = anzahl.toIntOrNull() ?: 1,
    preis = NumericInput.readMoney(preis),
    zustand = zustand,
    besitzer = if (haushalt.size > 1) besitzer else null,
)

/** Ob Anzahl oder Preis etwas Unlesbares tragen; dann speichert der Dialog nicht, und das Feld sagt warum. */
fun entryInvalid(anzahl: String, preis: String): Boolean =
    NumericInput.quantityInvalid(anzahl) || NumericInput.priceInvalid(preis)
