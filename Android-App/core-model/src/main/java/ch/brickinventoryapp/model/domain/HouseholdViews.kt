package ch.brickinventoryapp.model.domain

import ch.brickinventoryapp.model.data.ScopeFilter
import java.time.Instant

// Accounts, purchases and storage locations as the UI shows them.

/**
 * The entries of the account selection: all accounts, own, then every sub-account
 * by name — an entry always means exactly one account. Empty if there is nothing to
 * choose; then the selection stays hidden. Pairs of (value, label).
 */
fun accountOptions(members: List<MemberView>, labelAll: String, labelOwn: String): List<Pair<String, String>> {
    if (members.size < 2) return emptyList()
    return buildList {
        add(ScopeFilter.ALL to labelAll)
        add("own" to labelOwn)
        members.filter { !it.isSelf }.forEach { add(it.id.toString() to it.username) }
    }
}

data class MemberView(
    val id: Int = 0,
    val username: String = "",
    val isSelf: Boolean = false,
)

data class AccountView(
    val id: Int = 0,
    val username: String = "",
)

data class PurchaseView(
    val id: Int,
    val quantity: Int,
    val purchasePrice: Money? = null,
    val unitPrice: Money? = null,
    val condition: Condition = Condition.NEW,
    val createdAt: Instant? = null,
    val ownerUserId: Int? = null,
    val priceEstimated: Boolean = false,
    val currency: CurrencyCode? = null,
) {
    /** Sets carry purchase_price, parts and figures unit_price. */
    val effectivePrice: Money? get() = purchasePrice ?: unitPrice
}

/** The purchases of an entry including totals, from one response. */
data class PurchasesView(val purchases: List<PurchaseView>, val sums: PurchaseSumsView)

/** An invitation into the household; [validSeconds] null means without deadline. */
data class InvitationView(val code: String, val validSeconds: Int?)

data class PurchaseSumsView(
    val quantity: Int = 0,
    val amount: Money? = null,
)

data class LocationView(
    val location: String,
    val sets: Int = 0,
    val parts: Int = 0,
)

data class LocationEntryView(
    val id: Int = 0,
    val userId: Int = 0,
    val name: String = "",
)

/** A place of the own supply; [default] is the star that adding preselects. */
data class StockLocationView(
    val location: LocationEntryView,
    val default: Boolean = false,
)
