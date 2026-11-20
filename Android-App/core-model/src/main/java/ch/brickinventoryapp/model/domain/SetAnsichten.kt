package ch.brickinventoryapp.model.domain

import java.time.Instant

// Sets und Merkposten, wie Galerie, Set-Detail und Merkliste sie zeigen.

data class SetAnsicht(
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
    val condition: Zustand? = null,
    val storage: String? = null,
    val conditions: List<Zustand> = emptyList(),
    val owners: List<AccountView> = emptyList(),
    val maxPurchasePrice: Geld? = null,
    val avgPurchasePrice: Geld? = null,
    val usedCount: Int? = null,
    val instructions: List<InstructionView> = emptyList(),
    val bricklink: BrickLinkView? = null,
    val preisvergleichUrl: String? = null,
) {
    /** Der angezeigte Kaufpreis, mengengewichtet — Kachel und Detail zeigen denselben. */
    val displayPurchasePrice: Geld? get() = avgPurchasePrice
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
    val condition: Zustand = Zustand.NEU,
    val createdAt: Instant? = null,
    val userId: Int = 0,
    val name: String? = null,
    val year: Int? = null,
    val numParts: Int? = null,
    val imageUrl: String? = null,
    val imageLocal: String? = null,
    val marktpreis: Geld? = null,
    val waehrung: Waehrung = Waehrung.EUR,
    val owned: Boolean = false,
    val alarm: WantedItemAlarmView? = null,
    val preisvergleichUrl: String? = null,
)

data class WantedItemAlarmView(
    val richtung: Alarmrichtung = Alarmrichtung.UNTER,
    val schwelle: Geld = Geld.NULL,
    val ausgeloest: Boolean = false,
)
