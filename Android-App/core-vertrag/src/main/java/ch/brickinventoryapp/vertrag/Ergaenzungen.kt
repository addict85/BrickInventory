package ch.brickinventoryapp.vertrag

import ch.brickinventoryapp.model.fach.Zustand

// Kennungen und abgeleitete Werte zu den erzeugten Typen (Vertrag.kt): Der Erzeuger
// schreibt nur Felder; was die App daraus liest, steht einmal hier statt je Aufrufer.

/** Nur die Zustände, zu denen der Server eine Zeile geliefert hat. */
fun PriceByCondition.present(): List<Pair<Zustand, ConditionValuation>> = buildList {
    new?.let { add(Zustand.NEU to it) }
    used?.let { add(Zustand.GEBRAUCHT to it) }
}

/** Alle Elternkonten; ein älterer Server schickt nur `linked_to`. */
val HouseholdStatusResponse.elternkonten: List<KontoName>
    get() = parents.ifEmpty { listOfNotNull(linkedTo) }

/** Sets führen den Preis als `purchase_price`, Teile und Figuren als `unit_price`. */
val Acquisition.effectivePrice: Double? get() = purchasePrice ?: unitPrice

/** Mengengewichtet vom Server, damit Kachel und Detail dieselbe Zahl zeigen. */
val SetItem.anzeigeKaufpreis: Double? get() = avgPurchasePrice

/** Neu angelegte Zeilen eines CSV-Imports. */
val CsvImportErgebnis.neuAngelegt: Int get() = added

/**
 * Der Server liest den Preis unter dem Namen seiner Spalte: `purchase_price` bei Sets,
 * `unit_price` bei Teilen und Figuren; unter dem falschen Namen bliebe er still gleich.
 */
fun aenderungFuerSet(
    preis: Double? = null,
    condition: Zustand? = null,
    quantity: Int? = null,
    date: String? = null,
    ownerUserId: Int? = null,
) = UpdateAcquisitionRequest(
    purchasePrice = preis, condition = condition, quantity = quantity, date = date, ownerUserId = ownerUserId,
)

/** Für Teile und Minifiguren: Preis geht als `unit_price`. Siehe [aenderungFuerSet]. */
fun aenderungFuerStueck(
    preis: Double? = null,
    condition: Zustand? = null,
    quantity: Int? = null,
    date: String? = null,
    ownerUserId: Int? = null,
) = UpdateAcquisitionRequest(
    unitPrice = preis, condition = condition, quantity = quantity, date = date, ownerUserId = ownerUserId,
)

/** Ein Ort im Vorrat, wie die Ablage ihn führt: [vorgabe] ist der Stern, den der Server neben der Liste schickt. */
data class VorratsOrt(val ort: LagerortEintrag, val vorgabe: Boolean)
