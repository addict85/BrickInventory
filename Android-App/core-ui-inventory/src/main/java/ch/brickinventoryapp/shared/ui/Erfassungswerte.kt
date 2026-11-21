package ch.brickinventoryapp.shared.ui

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.ui.util.NumericInput

/**
 * The four inputs, as the server needs them — one conversion for both
 * dialogs: an empty quantity means one, the price is read like in the web app
 * (NumericInput.readAmount), and without a household no owner goes along, so the
 * server stays with its own account. An unreadable input isn't silently turned into
 * one or „no price" here: whoever saves asks [entryInvalid] first.
 */
data class EntryValues(
    val anzahl: Int,
    val preis: Geld?,
    val zustand: Zustand,
    val besitzer: Int?,
)

/**
 * @param haushalt The household's accounts — with at most one, NO
 *                 owner goes along.
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

/** Whether quantity or price carry something unreadable; if so the dialog doesn't save, and the field says why. */
fun entryInvalid(anzahl: String, preis: String): Boolean =
    NumericInput.quantityInvalid(anzahl) || NumericInput.priceInvalid(preis)
