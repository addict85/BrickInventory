package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.domain.Setsortierung
import ch.brickinventoryapp.model.domain.Merksortierung
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.WantedItemView
import ch.brickinventoryapp.model.domain.SetAnsicht
import java.time.Instant

/**
 * The server's sortings (SET_SORTS) for the local list without network. It
 * lies in its default (newest first); because sortedWith is stable, this
 * sequence stays as the secondary order for equal values, as there. null = default.
 */
internal fun setOrder(sort: Setsortierung?): Comparator<SetAnsicht>? = when (sort) {
    Setsortierung.AELTESTE -> compareBy(nullsLast<Instant>()) { it.addedAt }
    Setsortierung.NAME -> compareBy(nullsLast(String.CASE_INSENSITIVE_ORDER)) { it.name }
    Setsortierung.NUMMER -> compareBy { it.setNumber }
    Setsortierung.JAHR -> compareBy(nullsLast(reverseOrder<Int>())) { it.year }
    Setsortierung.PREIS_ABSTEIGEND -> compareByDescending { it.maxPurchasePrice ?: Geld.NULL }
    Setsortierung.PREIS_AUFSTEIGEND -> compareBy { it.maxPurchasePrice ?: Geld.NULL }
    Setsortierung.MENGE_ABSTEIGEND -> compareByDescending { it.quantity }
    Setsortierung.MENGE_AUFSTEIGEND -> compareBy { it.quantity }
    Setsortierung.NEUESTE, null -> null
}

/** The same for the wishlist (MERK_SORTS); the price there is the market price. */
internal fun rememberOrder(sort: Merksortierung?): Comparator<WantedItemView>? = when (sort) {
    Merksortierung.AELTESTE -> compareBy(nullsLast<Instant>()) { it.createdAt }
    Merksortierung.NAME -> compareBy(nullsLast(String.CASE_INSENSITIVE_ORDER)) { it.name }
    Merksortierung.NUMMER -> compareBy { it.setNumber }
    Merksortierung.JAHR -> compareBy(nullsLast(reverseOrder<Int>())) { it.year }
    Merksortierung.PREIS_ABSTEIGEND -> compareBy(nullsLast(reverseOrder<Geld>())) { it.marktpreis }
    Merksortierung.PREIS_AUFSTEIGEND -> compareBy(nullsLast<Geld>()) { it.marktpreis }
    Merksortierung.NEUESTE, null -> null
}

internal fun <T> List<T>.sortiert(order: Comparator<in T>?): List<T> = order?.let { sortedWith(it) } ?: this

/** `spare` as a column value: null means all. */
internal fun Ersatzteilwahl.asFeature(): Boolean? = when (this) {
    Ersatzteilwahl.ALLE -> null
    Ersatzteilwahl.OHNE -> false
    Ersatzteilwahl.NUR -> true
}
