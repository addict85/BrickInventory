package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.model.data.model.Merkposten
import ch.brickinventoryapp.model.data.model.SetItem

/**
 * Die Sortierungen des Servers (SET_SORTS) für die lokale Liste ohne Netz. Sie
 * liegt in seiner Vorgabe (neueste zuerst); weil sortedWith stabil ist, bleibt
 * diese Folge bei gleichen Werten wie dort die zweite Ordnung. null = Vorgabe.
 */
internal fun setOrdnung(sort: String?): Comparator<SetItem>? = when (sort) {
    "added_asc" -> compareBy(nullsLast<String>()) { it.addedAt }
    "name_asc" -> compareBy(nullsLast(String.CASE_INSENSITIVE_ORDER)) { it.name }
    "num_asc" -> compareBy { it.setNumber }
    "year_desc" -> compareBy(nullsLast(reverseOrder<Int>())) { it.year }
    "price_desc" -> compareByDescending { it.maxPurchasePrice ?: 0.0 }
    "price_asc" -> compareBy { it.maxPurchasePrice ?: 0.0 }
    "qty_desc" -> compareByDescending { it.quantity }
    "qty_asc" -> compareBy { it.quantity }
    else -> null
}

/** Dasselbe für die Merkliste (MERK_SORTS); der Preis ist dort der Marktpreis. */
internal fun merkOrdnung(sort: String?): Comparator<Merkposten>? = when (sort) {
    "added_asc" -> compareBy(nullsLast<String>()) { it.createdAt }
    "name_asc" -> compareBy(nullsLast(String.CASE_INSENSITIVE_ORDER)) { it.name }
    "num_asc" -> compareBy { it.setNumber }
    "year_desc" -> compareBy(nullsLast(reverseOrder<Int>())) { it.year }
    "price_desc" -> compareBy(nullsLast(reverseOrder<Double>())) { it.marktpreis }
    "price_asc" -> compareBy(nullsLast<Double>()) { it.marktpreis }
    else -> null
}

internal fun <T> List<T>.sortiert(ordnung: Comparator<in T>?): List<T> = ordnung?.let { sortedWith(it) } ?: this

/** `spare` als Spaltenwert: null heisst alle. */
internal fun Ersatzteilwahl.alsMerkmal(): Boolean? = when (this) {
    Ersatzteilwahl.ALLE -> null
    Ersatzteilwahl.OHNE -> false
    Ersatzteilwahl.NUR -> true
}
