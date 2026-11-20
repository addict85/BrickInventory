package ch.brickinventoryapp.model.domain

import java.time.Instant

import ch.brickinventoryapp.model.data.ScopeFilter

// Konten, Käufe und Lagerorte, wie die Oberfläche sie zeigt.

/**
 * Die Einträge der Kontoauswahl: Alle Konten, Eigene, dann jedes Unterkonto
 * namentlich — ein Eintrag meint immer genau ein Konto. Leer, wenn es nichts zu
 * wählen gibt; dann bleibt die Auswahl verborgen. Paare aus (Wert, Beschriftung).
 */
fun accountOptions(mitglieder: List<MemberView>, labelAll: String, labelOwn: String): List<Pair<String, String>> {
    if (mitglieder.size < 2) return emptyList()
    return buildList {
        add(ScopeFilter.ALL to labelAll)
        add("own" to labelOwn)
        mitglieder.filter { !it.isSelf }.forEach { add(it.id.toString() to it.username) }
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

data class KaufAnsicht(
    val id: Int,
    val quantity: Int,
    val purchasePrice: Geld? = null,
    val unitPrice: Geld? = null,
    val condition: Zustand = Zustand.NEU,
    val createdAt: Instant? = null,
    val ownerUserId: Int? = null,
    val priceEstimated: Boolean = false,
    val currency: Waehrung? = null,
) {
    /** Sets tragen purchase_price, Teile und Figuren unit_price. */
    val effectivePrice: Geld? get() = purchasePrice ?: unitPrice
}

/** Die Käufe eines Eintrags samt Summen, aus einer Antwort. */
data class PurchasesView(val kaeufe: List<KaufAnsicht>, val sums: PurchaseSumsView)

/** Eine Einladung in den Haushalt; [validSeconds] null heisst ohne Frist. */
data class InvitationView(val code: String, val validSeconds: Int?)

data class PurchaseSumsView(
    val quantity: Int = 0,
    val amount: Geld? = null,
)

data class LocationView(
    val ort: String,
    val sets: Int = 0,
    val teile: Int = 0,
)

data class LocationEntryView(
    val id: Int = 0,
    val userId: Int = 0,
    val name: String = "",
)

/** Ein Ort des eigenen Vorrats; [vorgabe] ist der Stern, den das Erfassen vorauswählt. */
data class StockLocationView(
    val ort: LocationEntryView,
    val vorgabe: Boolean = false,
)
