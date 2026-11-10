package ch.brickinventoryapp.model.ui.model

import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.data.model.BrickLinkRef
import ch.brickinventoryapp.model.data.model.Instruction
import ch.brickinventoryapp.model.data.model.Merkposten
import ch.brickinventoryapp.model.data.model.MerkpostenAlarm
import ch.brickinventoryapp.model.data.model.SetItem

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
    val addedAt: String? = null,
    val condition: Zustand? = null,
    val storage: String? = null,
    val conditions: List<Zustand> = emptyList(),
    val owners: List<KontoAnsicht> = emptyList(),
    val maxPurchasePrice: Double? = null,
    val avgPurchasePrice: Double? = null,
    val usedCount: Int? = null,
    val instructions: List<AnleitungAnsicht> = emptyList(),
    val bricklink: BrickLinkAnsicht? = null,
    val preisvergleichUrl: String? = null,
) {
    /** Der angezeigte Kaufpreis, mengengewichtet — Kachel und Detail zeigen denselben. */
    val anzeigeKaufpreis: Double? get() = avgPurchasePrice
}

fun SetItem.alsAnsicht() = SetAnsicht(
    setNumber = setNumber,
    name = name,
    year = year,
    theme = theme,
    pieces = pieces,
    minifigs = minifigs,
    quantity = quantity,
    imageUrl = imageUrl,
    imageLocal = imageLocal,
    addedAt = addedAt,
    condition = condition,
    storage = storage,
    conditions = conditions,
    owners = owners.map { it.alsAnsicht() },
    maxPurchasePrice = maxPurchasePrice,
    avgPurchasePrice = avgPurchasePrice,
    usedCount = usedCount,
    instructions = instructions.map { it.alsAnsicht() },
    bricklink = bricklink?.alsAnsicht(),
    preisvergleichUrl = preisvergleichUrl,
)

data class AnleitungAnsicht(
    val id: Int? = null,
    val url: String,
    val description: String? = null,
    val localPath: String? = null,
    val isManual: Boolean = false,
)

fun Instruction.alsAnsicht() = AnleitungAnsicht(
    id = id,
    url = url,
    description = description,
    localPath = localPath,
    isManual = isManual,
)

data class BrickLinkAnsicht(
    val type: String = "SET",
    val number: String = "",
    val url: String? = null,
    val exact: Boolean = true,
    val resolved: Boolean = false,
)

fun BrickLinkRef.alsAnsicht() = BrickLinkAnsicht(
    type = type,
    number = number,
    url = url,
    exact = exact,
    resolved = resolved,
)

data class MerkpostenAnsicht(
    val setNumber: String = "",
    val condition: Zustand = Zustand.NEU,
    val createdAt: String? = null,
    val userId: Int = 0,
    val name: String? = null,
    val year: Int? = null,
    val numParts: Int? = null,
    val imageUrl: String? = null,
    val imageLocal: String? = null,
    val marktpreis: Double? = null,
    val waehrung: String = "EUR",
    val owned: Boolean = false,
    val alarm: MerkpostenAlarmAnsicht? = null,
    val preisvergleichUrl: String? = null,
)

fun Merkposten.alsAnsicht() = MerkpostenAnsicht(
    setNumber = setNumber,
    condition = condition,
    createdAt = createdAt,
    userId = userId,
    name = name,
    year = year,
    numParts = numParts,
    imageUrl = imageUrl,
    imageLocal = imageLocal,
    marktpreis = marktpreis,
    waehrung = waehrung,
    owned = owned,
    alarm = alarm?.alsAnsicht(),
    preisvergleichUrl = preisvergleichUrl,
)

data class MerkpostenAlarmAnsicht(
    val richtung: String = "unter",
    val schwelle: Double = 0.0,
    val ausgeloest: Boolean = false,
)

fun MerkpostenAlarm.alsAnsicht() = MerkpostenAlarmAnsicht(
    richtung = richtung,
    schwelle = schwelle,
    ausgeloest = ausgeloest,
)
