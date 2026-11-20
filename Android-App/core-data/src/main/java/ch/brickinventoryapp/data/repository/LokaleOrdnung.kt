package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Setsortierung
import ch.brickinventoryapp.model.fach.Merksortierung
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.model.fach.Geld
import ch.brickinventoryapp.model.fach.WantedItemView
import ch.brickinventoryapp.model.fach.SetAnsicht
import java.time.Instant

/**
 * Die Sortierungen des Servers (SET_SORTS) für die lokale Liste ohne Netz. Sie
 * liegt in seiner Vorgabe (neueste zuerst); weil sortedWith stabil ist, bleibt
 * diese Folge bei gleichen Werten wie dort die zweite Ordnung. null = Vorgabe.
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

/** Dasselbe für die Merkliste (MERK_SORTS); der Preis ist dort der Marktpreis. */
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

/** `spare` als Spaltenwert: null heisst alle. */
internal fun Ersatzteilwahl.asFeature(): Boolean? = when (this) {
    Ersatzteilwahl.ALLE -> null
    Ersatzteilwahl.OHNE -> false
    Ersatzteilwahl.NUR -> true
}
