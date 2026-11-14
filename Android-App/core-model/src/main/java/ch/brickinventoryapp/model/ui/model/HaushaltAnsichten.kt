package ch.brickinventoryapp.model.ui.model

import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.data.ScopeFilter

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

data class KontoAnsicht(
    val id: Int = 0,
    val username: String = "",
)

data class KaufAnsicht(
    val id: Int,
    val quantity: Int,
    val purchasePrice: Double? = null,
    val unitPrice: Double? = null,
    val condition: Zustand = Zustand.NEU,
    val createdAt: String? = null,
    val ownerUserId: Int? = null,
    val priceEstimated: Boolean = false,
    val currency: Waehrung? = null,
) {
    /** Sets tragen purchase_price, Teile und Figuren unit_price. */
    val effectivePrice: Double? get() = purchasePrice ?: unitPrice
}

data class KaufSummenAnsicht(
    val quantity: Int = 0,
    val amount: Double? = null,
)

data class LagerortAnsicht(
    val ort: String,
    val sets: Int = 0,
    val teile: Int = 0,
)

data class LagerortEintragAnsicht(
    val id: Int = 0,
    val userId: Int = 0,
    val name: String = "",
)
