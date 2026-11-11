package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Setsortierung
import ch.brickinventoryapp.model.fach.Merksortierung
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.model.data.model.Merkposten
import ch.brickinventoryapp.model.data.model.SetItem

/**
 * Die Sortierungen des Servers (SET_SORTS) für die lokale Liste ohne Netz. Sie
 * liegt in seiner Vorgabe (neueste zuerst); weil sortedWith stabil ist, bleibt
 * diese Folge bei gleichen Werten wie dort die zweite Ordnung. null = Vorgabe.
 */
internal fun setOrdnung(sort: Setsortierung?): Comparator<SetItem>? = when (sort) {
    Setsortierung.AELTESTE -> compareBy(nullsLast<String>()) { it.addedAt }
    Setsortierung.NAME -> compareBy(nullsLast(String.CASE_INSENSITIVE_ORDER)) { it.name }
    Setsortierung.NUMMER -> compareBy { it.setNumber }
    Setsortierung.JAHR -> compareBy(nullsLast(reverseOrder<Int>())) { it.year }
    Setsortierung.PREIS_ABSTEIGEND -> compareByDescending { it.maxPurchasePrice ?: 0.0 }
    Setsortierung.PREIS_AUFSTEIGEND -> compareBy { it.maxPurchasePrice ?: 0.0 }
    Setsortierung.MENGE_ABSTEIGEND -> compareByDescending { it.quantity }
    Setsortierung.MENGE_AUFSTEIGEND -> compareBy { it.quantity }
    Setsortierung.NEUESTE, null -> null
}

/** Dasselbe für die Merkliste (MERK_SORTS); der Preis ist dort der Marktpreis. */
internal fun merkOrdnung(sort: Merksortierung?): Comparator<Merkposten>? = when (sort) {
    Merksortierung.AELTESTE -> compareBy(nullsLast<String>()) { it.createdAt }
    Merksortierung.NAME -> compareBy(nullsLast(String.CASE_INSENSITIVE_ORDER)) { it.name }
    Merksortierung.NUMMER -> compareBy { it.setNumber }
    Merksortierung.JAHR -> compareBy(nullsLast(reverseOrder<Int>())) { it.year }
    Merksortierung.PREIS_ABSTEIGEND -> compareBy(nullsLast(reverseOrder<Double>())) { it.marktpreis }
    Merksortierung.PREIS_AUFSTEIGEND -> compareBy(nullsLast<Double>()) { it.marktpreis }
    Merksortierung.NEUESTE, null -> null
}

internal fun <T> List<T>.sortiert(ordnung: Comparator<in T>?): List<T> = ordnung?.let { sortedWith(it) } ?: this

/** `spare` als Spaltenwert: null heisst alle. */
internal fun Ersatzteilwahl.alsMerkmal(): Boolean? = when (this) {
    Ersatzteilwahl.ALLE -> null
    Ersatzteilwahl.OHNE -> false
    Ersatzteilwahl.NUR -> true
}
