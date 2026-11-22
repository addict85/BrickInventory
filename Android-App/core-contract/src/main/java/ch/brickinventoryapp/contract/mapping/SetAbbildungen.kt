package ch.brickinventoryapp.contract.mapping

import ch.brickinventoryapp.contract.BrickLinkRef
import ch.brickinventoryapp.contract.Instruction
import ch.brickinventoryapp.contract.Merkposten
import ch.brickinventoryapp.contract.MerkpostenAlarm
import ch.brickinventoryapp.contract.SetItem
import ch.brickinventoryapp.model.domain.InstructionView
import ch.brickinventoryapp.model.domain.BrickLinkView
import ch.brickinventoryapp.model.domain.WantedItemAlarmView
import ch.brickinventoryapp.model.domain.WantedItemView
import ch.brickinventoryapp.model.domain.SetAnsicht
import ch.brickinventoryapp.model.domain.asMoney
import ch.brickinventoryapp.model.domain.asMoneyRequired
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
