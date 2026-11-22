package ch.brickinventoryapp.model.domain

import java.time.Instant

// Sets and wishlist items as gallery, set detail and wishlist show them.

data class SetView(
    val setNumber: String,
    val name: String? = null,
    val year: Int? = null,
    val theme: String? = null,
    val pieces: Int? = null,
    val minifigs: Int? = null,
    val quantity: Int = 1,
    val imageUrl: String? = null,
    val imageLocal: String? = null,
    val addedAt: Instant? = null,
    val condition: Condition? = null,
    val storage: String? = null,
    val conditions: List<Condition> = emptyList(),
    val owners: List<AccountView> = emptyList(),
    val maxPurchasePrice: Money? = null,
    val avgPurchasePrice: Money? = null,
    val usedCount: Int? = null,
    val instructions: List<InstructionView> = emptyList(),
    val bricklink: BrickLinkView? = null,
    val priceComparisonUrl: String? = null,
) {
    /** The displayed purchase price, quantity-weighted — tile and detail show the same. */
    val displayPurchasePrice: Money? get() = avgPurchasePrice
}

data class InstructionView(
    val id: Int? = null,
    val url: String,
    val description: String? = null,
    val localPath: String? = null,
    val isManual: Boolean = false,
)

data class BrickLinkView(
    val type: String = "SET",
    val number: String = "",
    val url: String? = null,
    val exact: Boolean = true,
    val resolved: Boolean = false,
)

data class WantedItemView(
    val setNumber: String = "",
    val condition: Condition = Condition.NEW,
    val createdAt: Instant? = null,
    val userId: Int = 0,
    val name: String? = null,
    val year: Int? = null,
    val numParts: Int? = null,
    val imageUrl: String? = null,
    val imageLocal: String? = null,
    val marketPrice: Money? = null,
    val currency: CurrencyCode = CurrencyCode.EUR,
    val owned: Boolean = false,
    val alarm: WantedItemAlarmView? = null,
    val priceComparisonUrl: String? = null,
)

data class WantedItemAlarmView(
    val direction: AlarmDirection = AlarmDirection.BELOW,
    val threshold: Money = Money.NULL,
    val triggered: Boolean = false,
)
