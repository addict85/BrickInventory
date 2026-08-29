package ch.brickinventoryapp.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Haushalt, Erfassungen und Verschieben.
 *
 * ── Warum diese Datei existiert (Nachtrag 155) ──────────────────────────────
 *
 * Alle 92 Datenklassen der App standen in EINER Datei, Models.kt, mit 1158
 * Zeilen. Jede Aenderung an irgendeinem Modell beruehrte dieselbe Datei — bei
 * parallelen Aenderungen ein sicherer Konflikt, und beim Suchen war der Weg
 * immer derselbe: eine Datei oeffnen und scrollen.
 *
 * Aufgeteilt wurde entlang der Sachgebiete. Die Klassen selbst sind WORTGLEICH
 * uebernommen: Es wurde nichts umbenannt, nichts zusammengefasst und kein Feld
 * angefasst. Sie liegen weiter im Paket ch.brickinventoryapp.data.model, also
 * aendert sich fuer keinen Aufrufer etwas — Kotlin bindet an das Paket, nicht
 * an die Datei.
 */

// ═══════════════════════════════════════════════════════════════════════════
// HAUSHALT — verknüpfte Konten
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Eine Familie verwaltet die Sammlung je Kind in einem eigenen Konto; das
 * Hauptkonto sieht alles zusammen und darf verschieben.
 *
 * Entschieden wird das ausschliesslich auf dem Server (utils/household.ts):
 * Das Blickfeld, die Schreibrechte und die Regeln (eine Stufe, gleiche
 * Währung) stehen dort. Die App zeigt nur, was ankommt — eine zweite Fassung
 * derselben Regeln hier wäre genau die Doppelung, an der in diesem Projekt
 * schon mehrere Zahlen auseinandergelaufen sind.
 */
@Serializable
data class HouseholdMember(
    val id: Int = 0,
    val username: String = "",
    @SerialName("is_self") val isSelf: Boolean = false,
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
    @SerialName("sub_accounts") val subAccounts: List<HouseholdMember> = emptyList(),
    @SerialName("open_invites") val openInvites: Int = 0,
    val error: String? = null,
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
    /** Leer = das ganze Set; sonst nur diese Kaufpreis-Zeilen. */
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
     * Eigentümer DIESER Zeile — im Haushalt können die Kaufpreise eines Sets
     * mehreren Konten gehören. Ohne das Feld wüsste die Eigentümer-Auswahl
     * nicht, worauf sie steht, und ein Wechsel griffe die falsche Zeile ab.
     */
    @SerialName("owner_user_id") val ownerUserId: Int? = null
) {
    // Effective price: whichever field is set (sets use purchase_price, parts/figs use unit_price)
    val effectivePrice: Double? get() = purchasePrice ?: unitPrice
}

/**
 * Summenzeile einer Erfassungsliste — vom SERVER gerechnet.
 *
 * Die Rechnung stand vorher viermal in den Oberflächen (zweimal hier, zweimal
 * in der Webapp) und war sich nicht einmal einig, aus welchem Feld der Preis
 * kommt. Jetzt liegt sie in utils/acquisitions.ts (`acquisitionTotals`), und
 * beide Clients zeigen dasselbe an.
 *
 * `amount = null` heisst „kein Kaufpreis erfasst" — nicht „null Franken".
 * Genau deshalb entscheidet der Server das und nicht die Ansicht.
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
     * Vorgabe für ältere Serverstände: leere Summe. Die Ansichten zeigen dann
     * „×0" und einen Gedankenstrich statt einer selbst gerechneten Zahl —
     * lieber sichtbar leer als still abweichend.
     */
    val totals: AcquisitionTotals = AcquisitionTotals()
)

@Serializable
data class UpdateAcquisitionRequest(
    /**
     * Der Kaufpreis EINER Erfassungszeile — bei SETS.
     *
     * ── Zwei Feldnamen, kein Versehen des Servers (Nachtrag 111) ────────────
     *
     * Marcos Befund: „Wenn ich in der Android-App den Kaufpreis anpasse, wird
     * er nicht gespeichert."
     *
     * Der Server liest das Preisfeld unter dem Namen der jeweiligen Spalte
     * (`req.body[cfg.priceCol]`):
     *
     *     Sets                    → purchase_price
     *     Teile und Minifiguren   → unit_price
     *
     * Das ist konsequent: Bei einem Set ist es der Preis des Sets, bei Teilen
     * und Minifiguren der Preis JE STÜCK. Die Webapp bedient beide Namen seit
     * jeher; die App schickte immer `purchase_price`. Für Teile und
     * Minifiguren fand der Server also kein Preisfeld — und liess den Preis
     * unverändert, ohne Fehler zu melden.
     *
     * Beide Felder sind nullbar und werden bei `null` nicht mitgeschickt
     * (kotlinx.serialization lässt Vorgabewerte weg). Es wird also immer genau
     * eines gesetzt — siehe `fuerSet()` und `fuerStueck()` unten.
     */
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    /** Der Kaufpreis je Stück — bei TEILEN und MINIFIGUREN. Siehe oben. */
    @SerialName("unit_price") val unitPrice: Double? = null,
    val condition: String? = null,
    val quantity: Int? = null,
    val date: String? = null,
    /**
     * Eigentümerwechsel = Verschieben genau dieser Kaufpreis-Zeile.
     *
     * Der Server behandelt das Feld VOR allen anderen und beendet die Anfrage
     * damit: Preis oder Datum derselben Zeile im selben Aufruf zu ändern
     * hiesse, sie zweimal zu suchen — einmal beim Absender, einmal beim
     * Empfänger, wo sie womöglich schon mit einer Tageszeile verschmolzen ist.
     *
     * Der ABSENDER wird nicht mitgeschickt: Die Erfassungs-ID ist eindeutig,
     * und wem die Zeile gehört, ermittelt der Server aus der Zeile selbst
     * (acquisitionMoveSource). Ein Client kann die Frage damit nicht mehr
     * falsch beantworten — genau daran ist der Wechsel in der Webapp
     * gescheitert. MoveSetRequest behält from_user_id: Dort geht es um
     * mehrere Zeilen auf einmal, und der Absender ist Teil der Auswahl.
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
