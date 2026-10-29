package ch.brickinventoryapp.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Haushalt, Erfassungen und Verschieben — ein Sachgebiet der Modelle. Getrennte
 * Dateien, damit parallele Änderungen nicht immer dieselbe Datei berühren; das
 * Paket bleibt ch.brickinventoryapp.data.model, Kotlin bindet an das Paket, nicht
 * an die Datei.
 */

// ═══════════════════════════════════════════════════════════════════════════
// HAUSHALT — verknüpfte Konten
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Eine Familie verwaltet die Sammlung je Kind in einem eigenen Konto; das
 * Hauptkonto sieht alles zusammen und darf verschieben. Entschieden wird
 * ausschliesslich auf dem Server (utils/household.ts: Blickfeld, Schreibrechte,
 * eine Stufe, gleiche Währung). Die App zeigt nur, was ankommt — eine zweite
 * Fassung der Regeln liefe auseinander.
 */
@Serializable
data class HouseholdMember(
    val id: Int = 0,
    val username: String = "",
    @SerialName("is_self") val isSelf: Boolean = false,
    /** 0 = eigenes Konto, 1 = Unterkonto. Ältere Server schickten tiefere Stufen. */
    val tiefe: Int = 1,
)

@Serializable
data class HouseholdMembersResponse(
    val success: Boolean = false,
    val members: List<HouseholdMember> = emptyList(),
)

@Serializable
data class HouseholdStatusResponse(
    val success: Boolean = false,
    @SerialName("is_main") val isMain: Boolean = false,
    @SerialName("is_sub")  val isSub: Boolean = false,
    val currency: String = "",
    @SerialName("linked_to") val linkedTo: HouseholdMember? = null,
    /** Alle Elternkonten; ein älterer Server schickt nur [linkedTo]. */
    val parents: List<HouseholdMember> = emptyList(),
    @SerialName("sub_accounts") val subAccounts: List<HouseholdMember> = emptyList(),
    @SerialName("open_invites") val openInvites: Int = 0,
    /** Konten, die nur über eine Kette sichtbar waren und es nicht mehr sind. */
    @SerialName("former_links") val formerLinks: List<GetrenntesKonto> = emptyList(),
    val error: String? = null,
) {
    val elternkonten: List<HouseholdMember>
        get() = parents.ifEmpty { listOfNotNull(linkedTo) }
}

@Serializable
data class GetrenntesKonto(
    val id: Int,
    val username: String = "",
    /** Das Unterkonto, über das die Sicht bisher lief. */
    val via: String? = null,
)

@Serializable
data class HouseholdInviteResponse(
    val success: Boolean = false,
    val code: String? = null,
    @SerialName("expires_in") val expiresIn: Int? = null,
    val error: String? = null,
)

@Serializable
data class MoveSetRequest(
    @SerialName("from_user_id") val fromUserId: Int? = null,
    @SerialName("to_user_id")   val toUserId: Int,
    /** Die Kaufpreis-Zeilen, die wandern — der Server verlangt mindestens eine. */
    @SerialName("acquisition_ids") val acquisitionIds: List<Int>? = null,
)

@Serializable
data class MoveSetResponse(
    val success: Boolean = false,
    @SerialName("set_number") val setNumber: String = "",
    val quantity: Int = 0,
    val acquisitions: Int = 0,
    /** true, wenn das Zielkonto das Set schon besass und zusammengefasst wurde. */
    val merged: Boolean = false,
    val parts: Int = 0,
    val minifigs: Int = 0,
    val instructions: Int = 0,
    /** true, wenn beim Absender das letzte Exemplar gegangen ist. */
    @SerialName("source_emptied") val sourceEmptied: Boolean = false,
    val error: String? = null,
)

@Serializable
data class Acquisition(
    val id: Int,
    val quantity: Int,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("unit_price") val unitPrice: Double? = null, // for parts/figs
    val condition: String = "N", // "N" = Neu, "U" = Gebraucht
    @SerialName("created_at") val createdAt: String? = null,
    /**
     * Eigentümer dieser Zeile — im Haushalt können die Kaufpreise eines Sets mehreren
     * Konten gehören. Ohne das Feld wüsste die Eigentümer-Auswahl nicht, worauf sie
     * steht, und ein Wechsel griffe die falsche Zeile ab.
     */
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    /** Ein eingesetzter Marktpreis, kein bezahlter Betrag. */
    @SerialName("price_estimated") val priceEstimated: Boolean = false,
    /** Währung, in der der Preis erfasst wurde. */
    val currency: String? = null,
) {
    // Effective price: whichever field is set (sets use purchase_price, parts/figs use unit_price)
    val effectivePrice: Double? get() = purchasePrice ?: unitPrice
}

/**
 * Summenzeile einer Erfassungsliste — vom Server gerechnet (utils/acquisitions.ts,
 * `acquisitionTotals`), damit beide Clients dasselbe zeigen. `amount = null`
 * heisst „kein Kaufpreis erfasst“, nicht „null Franken“ — deshalb entscheidet das
 * der Server und nicht die Ansicht.
 */
@Serializable
data class AcquisitionTotals(
    val quantity: Int = 0,
    val amount: Double? = null,
    @SerialName("priced_rows") val pricedRows: Int = 0
)

@Serializable
data class AcquisitionsResponse(
    val success: Boolean,
    val acquisitions: List<Acquisition> = emptyList(),
    /**
     * Vorgabe für ältere Serverstände: leere Summe. Die Ansichten zeigen dann „×0“ und
     * einen Gedankenstrich statt einer selbst gerechneten Zahl — lieber sichtbar leer
     * als still abweichend.
     */
    val totals: AcquisitionTotals = AcquisitionTotals()
)

@Serializable
data class UpdateAcquisitionRequest(
    /**
     * Der Kaufpreis einer Erfassungszeile — bei Sets. Der Server liest das Preisfeld
     * unter dem Namen der Spalte (`req.body[cfg.priceCol]`):
     *
     *     Sets                    → purchase_price
     *     Teile und Minifiguren   → unit_price
     *
     * Bei einem Set ist es der Preis des Sets, bei Teilen und Figuren der Preis je
     * Stück. Unter dem falschen Namen lässt der Server den Preis still unverändert.
     * Beide Felder sind nullbar; `fuerSet()` und `fuerStueck()` unten setzen immer
     * genau eines, das andere geht als null mit (ApiJson schreibt Vorgabewerte).
     */
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    /** Der Kaufpreis je Stück — bei TEILEN und MINIFIGUREN. Siehe oben. */
    @SerialName("unit_price") val unitPrice: Double? = null,
    val condition: String? = null,
    val quantity: Int? = null,
    val date: String? = null,
    /**
     * Eigentümerwechsel = Verschieben genau dieser Kaufpreis-Zeile. Der Server
     * behandelt das Feld vor allen anderen und beendet damit die Anfrage: Preis oder
     * Datum im selben Aufruf hiesse, die Zeile zweimal zu suchen, beim Empfänger
     * womöglich schon verschmolzen.
     *
     * Der Absender wird nicht mitgeschickt: Die Erfassungs-ID ist eindeutig, und wem
     * die Zeile gehört, ermittelt der Server (acquisitionMoveSource) — ein Client kann
     * das nicht falsch beantworten. MoveSetRequest behält from_user_id, weil dort
     * mehrere Zeilen gemeint sind und der Absender Teil der Auswahl ist.
     */
    @SerialName("owner_user_id") val ownerUserId: Int? = null
) {
    companion object {
        /** Für Set-Erfassungen: Preis geht als `purchase_price`. */
        fun fuerSet(
            preis: Double? = null, condition: String? = null, quantity: Int? = null,
            date: String? = null, ownerUserId: Int? = null,
        ) = UpdateAcquisitionRequest(
            purchasePrice = preis, condition = condition, quantity = quantity,
            date = date, ownerUserId = ownerUserId)

        /** Für Teile und Minifiguren: Preis geht als `unit_price`. */
        fun fuerStueck(
            preis: Double? = null, condition: String? = null, quantity: Int? = null,
            date: String? = null, ownerUserId: Int? = null,
        ) = UpdateAcquisitionRequest(
            unitPrice = preis, condition = condition, quantity = quantity,
            date = date, ownerUserId = ownerUserId)
    }
}
