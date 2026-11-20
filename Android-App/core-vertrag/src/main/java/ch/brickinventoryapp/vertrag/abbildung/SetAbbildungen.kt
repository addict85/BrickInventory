package ch.brickinventoryapp.vertrag.abbildung

import ch.brickinventoryapp.vertrag.BrickLinkRef
import ch.brickinventoryapp.vertrag.Instruction
import ch.brickinventoryapp.vertrag.Merkposten
import ch.brickinventoryapp.vertrag.MerkpostenAlarm
import ch.brickinventoryapp.vertrag.SetItem
import ch.brickinventoryapp.model.fach.InstructionView
import ch.brickinventoryapp.model.fach.BrickLinkView
import ch.brickinventoryapp.model.fach.WantedItemAlarmView
import ch.brickinventoryapp.model.fach.WantedItemView
import ch.brickinventoryapp.model.fach.SetAnsicht
import ch.brickinventoryapp.model.fach.asMoney
import ch.brickinventoryapp.model.fach.asMoneyRequired
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
    maxPurchasePrice = maxPurchasePrice.asMoney(),
    avgPurchasePrice = avgPurchasePrice.asMoney(),
    usedCount = usedCount,
    instructions = instructions.map { it.alsAnsicht() },
    bricklink = bricklink?.alsAnsicht(),
    preisvergleichUrl = preisvergleichUrl,
)

fun Instruction.alsAnsicht() = InstructionView(
    id = id,
    url = url,
    description = description,
    localPath = localPath,
    isManual = isManual,
)

fun BrickLinkRef.alsAnsicht() = BrickLinkView(
    type = type,
    number = number,
    url = url,
    exact = exact,
    resolved = resolved,
)

fun Merkposten.alsAnsicht() = WantedItemView(
    setNumber = setNumber,
    condition = condition,
    createdAt = zeitpunkt(createdAt),
    userId = userId,
    name = name,
    year = year,
    numParts = numParts,
    imageUrl = imageUrl,
    imageLocal = imageLocal,
    marktpreis = marktpreis.asMoney(),
    waehrung = waehrung,
    owned = owned,
    alarm = alarm?.alsAnsicht(),
    preisvergleichUrl = preisvergleichUrl,
)

fun MerkpostenAlarm.alsAnsicht() = WantedItemAlarmView(
    richtung = direction,
    schwelle = threshold.asMoneyRequired(),
    ausgeloest = triggered,
)
