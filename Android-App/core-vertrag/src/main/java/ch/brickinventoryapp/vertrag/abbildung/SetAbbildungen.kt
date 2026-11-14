package ch.brickinventoryapp.vertrag.abbildung

import ch.brickinventoryapp.vertrag.BrickLinkRef
import ch.brickinventoryapp.vertrag.Instruction
import ch.brickinventoryapp.vertrag.Merkposten
import ch.brickinventoryapp.vertrag.MerkpostenAlarm
import ch.brickinventoryapp.vertrag.SetItem
import ch.brickinventoryapp.model.ui.model.AnleitungAnsicht
import ch.brickinventoryapp.model.ui.model.BrickLinkAnsicht
import ch.brickinventoryapp.model.ui.model.MerkpostenAlarmAnsicht
import ch.brickinventoryapp.model.ui.model.MerkpostenAnsicht
import ch.brickinventoryapp.model.ui.model.SetAnsicht

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

fun Instruction.alsAnsicht() = AnleitungAnsicht(
    id = id,
    url = url,
    description = description,
    localPath = localPath,
    isManual = isManual,
)

fun BrickLinkRef.alsAnsicht() = BrickLinkAnsicht(
    type = type,
    number = number,
    url = url,
    exact = exact,
    resolved = resolved,
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

fun MerkpostenAlarm.alsAnsicht() = MerkpostenAlarmAnsicht(
    richtung = richtung,
    schwelle = schwelle,
    ausgeloest = ausgeloest,
)
