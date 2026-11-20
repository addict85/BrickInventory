package ch.brickinventoryapp.vertrag.abbildung

import ch.brickinventoryapp.vertrag.BrickLinkRef
import ch.brickinventoryapp.vertrag.Instruction
import ch.brickinventoryapp.vertrag.Merkposten
import ch.brickinventoryapp.vertrag.MerkpostenAlarm
import ch.brickinventoryapp.vertrag.SetItem
import ch.brickinventoryapp.model.fach.AnleitungAnsicht
import ch.brickinventoryapp.model.fach.BrickLinkAnsicht
import ch.brickinventoryapp.model.fach.MerkpostenAlarmAnsicht
import ch.brickinventoryapp.model.fach.MerkpostenAnsicht
import ch.brickinventoryapp.model.fach.SetAnsicht
import ch.brickinventoryapp.model.fach.alsGeld
import ch.brickinventoryapp.model.fach.alsGeldPflicht
import ch.brickinventoryapp.model.util.zeitpunkt

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
    addedAt = zeitpunkt(addedAt),
    condition = condition,
    storage = storage,
    conditions = conditions,
    owners = owners.map { it.alsAnsicht() },
    maxPurchasePrice = maxPurchasePrice.alsGeld(),
    avgPurchasePrice = avgPurchasePrice.alsGeld(),
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
    createdAt = zeitpunkt(createdAt),
    userId = userId,
    name = name,
    year = year,
    numParts = numParts,
    imageUrl = imageUrl,
    imageLocal = imageLocal,
    marktpreis = marktpreis.alsGeld(),
    waehrung = waehrung,
    owned = owned,
    alarm = alarm?.alsAnsicht(),
    preisvergleichUrl = preisvergleichUrl,
)

fun MerkpostenAlarm.alsAnsicht() = MerkpostenAlarmAnsicht(
    richtung = direction,
    schwelle = threshold.alsGeldPflicht(),
    ausgeloest = triggered,
)
