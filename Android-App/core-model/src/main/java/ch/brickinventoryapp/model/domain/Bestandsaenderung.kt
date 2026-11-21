package ch.brickinventoryapp.model.domain

// What an edit of the stock carries when it waits in the outbox or the store catches up.

/** A wishlist item that shall be created; [besitzer] null means the own account. */
data class Merkwunsch(val setNumber: String, val zustand: Zustand = Zustand.NEU, val besitzer: Int? = null)

/**
 * What is changed on a manual part or a figure. With [schritt] two devices add
 * up (quantity_delta); a server without it takes [menge], then the last one wins.
 */
data class Stueckaenderung(
    val menge: Int,
    val schritt: Int? = null,
    val stueckpreis: Geld? = null,
    val zustand: Zustand? = null,
    val blNumber: String? = null,
)

/**
 * The purchase total of a set after a purchase change, complete: a price null means
 * „none recorded“, not „unknown“.
 */
data class Setzusammenfassung(
    val setNumber: String,
    val zustand: Zustand,
    val states: List<Zustand>,
    val gebraucht: Int,
    val highestPurchasePrice: Geld?,
    val purchasePriceCut: Geld?,
)
