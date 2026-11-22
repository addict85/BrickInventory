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
import ch.brickinventoryapp.model.domain.SetView
import ch.brickinventoryapp.model.domain.asMoney
import ch.brickinventoryapp.model.domain.asMoneyRequired
import ch.brickinventoryapp.model.util.parseInstant

fun SetItem.asView() = SetView(
    setNumber = setNumber,
    name = name,
    year = year,
    theme = theme,
    pieces = pieces,
    minifigs = minifigs,
    quantity = quantity,
    imageUrl = imageUrl,
    imageLocal = imageLocal,
    addedAt = parseInstant(addedAt),
    condition = condition,
    storage = storage,
    conditions = conditions,
    owners = owners.map { it.asView() },
    maxPurchasePrice = maxPurchasePrice.asMoney(),
    avgPurchasePrice = avgPurchasePrice.asMoney(),
    usedCount = usedCount,
    instructions = instructions.map { it.asView() },
    bricklink = bricklink?.asView(),
    priceComparisonUrl = preisvergleichUrl,
)

fun Instruction.asView() = InstructionView(
    id = id,
    url = url,
    description = description,
    localPath = localPath,
    isManual = isManual,
)

fun BrickLinkRef.asView() = BrickLinkView(
    type = type,
    number = number,
    url = url,
    exact = exact,
    resolved = resolved,
)

fun Merkposten.asView() = WantedItemView(
    setNumber = setNumber,
    condition = condition,
    createdAt = parseInstant(createdAt),
    userId = userId,
    name = name,
    year = year,
    numParts = numParts,
    imageUrl = imageUrl,
    imageLocal = imageLocal,
    marketPrice = marktpreis.asMoney(),
    currency = waehrung,
    owned = owned,
    alarm = alarm?.asView(),
    priceComparisonUrl = preisvergleichUrl,
)

fun MerkpostenAlarm.asView() = WantedItemAlarmView(
    direction = direction,
    threshold = threshold.asMoneyRequired(),
    triggered = triggered,
)
