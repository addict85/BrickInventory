package ch.brickinventoryapp.ui.model

import ch.brickinventoryapp.data.ScopeFilter
import ch.brickinventoryapp.data.model.Acquisition
import ch.brickinventoryapp.data.model.AcquisitionTotals
import ch.brickinventoryapp.data.model.HouseholdMember
import ch.brickinventoryapp.data.model.KontoName
import ch.brickinventoryapp.data.model.Lagerort
import ch.brickinventoryapp.data.model.LagerortEintrag

// Konten, Käufe und Lagerorte, wie die Oberfläche sie zeigt.

/**
 * Die Einträge der Kontoauswahl: Alle Konten, Eigene, dann jedes Unterkonto
 * namentlich — ein Eintrag meint immer genau ein Konto. Leer, wenn es nichts zu
 * wählen gibt; dann bleibt die Auswahl verborgen. Paare aus (Wert, Beschriftung).
 */
fun kontoOptionen(mitglieder: List<MitgliedAnsicht>, labelAll: String, labelOwn: String): List<Pair<String, String>> {
    if (mitglieder.size < 2) return emptyList()
    return buildList {
        add(ScopeFilter.ALL to labelAll)
        add("own" to labelOwn)
        mitglieder.filter { !it.isSelf }.forEach { add(it.id.toString() to it.username) }
    }
}

data class MitgliedAnsicht(
    val id: Int = 0,
    val username: String = "",
    val isSelf: Boolean = false,
)

fun HouseholdMember.alsAnsicht() = MitgliedAnsicht(
    id = id,
    username = username,
    isSelf = isSelf,
)

data class KontoAnsicht(
    val id: Int = 0,
    val username: String = "",
)

fun KontoName.alsAnsicht() = KontoAnsicht(
    id = id,
    username = username,
)

data class KaufAnsicht(
    val id: Int,
    val quantity: Int,
    val purchasePrice: Double? = null,
    val unitPrice: Double? = null,
    val condition: String = "N",
    val createdAt: String? = null,
    val ownerUserId: Int? = null,
    val priceEstimated: Boolean = false,
    val currency: String? = null,
) {
    /** Sets tragen purchase_price, Teile und Figuren unit_price. */
    val effectivePrice: Double? get() = purchasePrice ?: unitPrice
}

fun Acquisition.alsAnsicht() = KaufAnsicht(
    id = id,
    quantity = quantity,
    purchasePrice = purchasePrice,
    unitPrice = unitPrice,
    condition = condition,
    createdAt = createdAt,
    ownerUserId = ownerUserId,
    priceEstimated = priceEstimated,
    currency = currency,
)

data class KaufSummenAnsicht(
    val quantity: Int = 0,
    val amount: Double? = null,
)

fun AcquisitionTotals.alsAnsicht() = KaufSummenAnsicht(
    quantity = quantity,
    amount = amount,
)

data class LagerortAnsicht(
    val ort: String,
    val sets: Int = 0,
    val teile: Int = 0,
)

fun Lagerort.alsAnsicht() = LagerortAnsicht(
    ort = ort,
    sets = sets,
    teile = teile,
)

data class LagerortEintragAnsicht(
    val id: Int = 0,
    val userId: Int = 0,
    val name: String = "",
)

fun LagerortEintrag.alsAnsicht() = LagerortEintragAnsicht(
    id = id,
    userId = userId,
    name = name,
)
