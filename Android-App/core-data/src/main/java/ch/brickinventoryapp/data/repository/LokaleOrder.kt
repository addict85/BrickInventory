package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.data.SparePartChoice
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.SetSort
import ch.brickinventoryapp.model.domain.SetView
import ch.brickinventoryapp.model.domain.WantedItemView
import ch.brickinventoryapp.model.domain.WantedSort
import java.time.Instant

/**
 * The server's sortings (SET_SORTS) for the local list without network. It
 * lies in its default (newest first); because sortedWith is stable, this
 * sequence stays as the secondary order for equal values, as there. null = default.
 */
internal fun setOrder(sort: SetSort?): Comparator<SetView>? = when (sort) {
    SetSort.OLDEST -> compareBy(nullsLast<Instant>()) { it.addedAt }
    SetSort.NAME -> compareBy(nullsLast(String.CASE_INSENSITIVE_ORDER)) { it.name }
    SetSort.NUMBER -> compareBy { it.setNumber }
    SetSort.YEAR -> compareBy(nullsLast(reverseOrder<Int>())) { it.year }
    SetSort.PRICE_DESCENDING -> compareByDescending { it.maxPurchasePrice ?: Money.NULL }
    SetSort.PRICE_ASCENDING -> compareBy { it.maxPurchasePrice ?: Money.NULL }
    SetSort.QUANTITY_DESCENDING -> compareByDescending { it.quantity }
    SetSort.QUANTITY_ASCENDING -> compareBy { it.quantity }
    SetSort.NEWEST, null -> null
}

/** The same for the wishlist (MERK_SORTS); the price there is the market price. */
internal fun rememberOrder(sort: WantedSort?): Comparator<WantedItemView>? = when (sort) {
    WantedSort.OLDEST -> compareBy(nullsLast<Instant>()) { it.createdAt }
    WantedSort.NAME -> compareBy(nullsLast(String.CASE_INSENSITIVE_ORDER)) { it.name }
    WantedSort.NUMBER -> compareBy { it.setNumber }
    WantedSort.YEAR -> compareBy(nullsLast(reverseOrder<Int>())) { it.year }
    WantedSort.PRICE_DESCENDING -> compareBy(nullsLast(reverseOrder<Money>())) { it.marketPrice }
    WantedSort.PRICE_ASCENDING -> compareBy(nullsLast<Money>()) { it.marketPrice }
    WantedSort.NEWEST, null -> null
}

internal fun <T> List<T>.sorted(order: Comparator<in T>?): List<T> = order?.let { sortedWith(it) } ?: this

/** `spare` as a column value: null means all. */
internal fun SparePartChoice.asFeature(): Boolean? = when (this) {
    SparePartChoice.ALL -> null
    SparePartChoice.WITHOUT -> false
    SparePartChoice.ONLY -> true
}
