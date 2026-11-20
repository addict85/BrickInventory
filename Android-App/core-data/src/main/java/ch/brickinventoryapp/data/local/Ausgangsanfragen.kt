package ch.brickinventoryapp.data.local

import ch.brickinventoryapp.model.domain.Erfassungswunsch
import ch.brickinventoryapp.model.domain.Figurenerfassung
import ch.brickinventoryapp.model.domain.Merkwunsch
import ch.brickinventoryapp.model.domain.Setzusammenfassung
import ch.brickinventoryapp.model.domain.Stueckaenderung
import ch.brickinventoryapp.model.domain.Teilerfassung
import ch.brickinventoryapp.model.domain.asMoney
import ch.brickinventoryapp.contract.AddMinifigRequest
import ch.brickinventoryapp.contract.AddPartRequest
import ch.brickinventoryapp.contract.AddSetRequest
import ch.brickinventoryapp.contract.MerkpostenRequest
import ch.brickinventoryapp.contract.SetAggregate
import ch.brickinventoryapp.contract.UpdateManualItemRequest

/*
 * Die Anfragen zu den Bearbeitungen der Ablage: Die Ablage hält Fachwerte, erst hier wird
 * daraus das Wire-Format, für den direkten Versuch wie für das Senden aus dem Ausgang.
 */

internal fun Erfassungswunsch.asRequest() = AddSetRequest(setNumber = setNumber, quantity = menge,
    purchasePrice = kaufpreis?.asDouble(), condition = zustand, ownerUserId = besitzer, storage = lagerort)

internal fun Merkwunsch.asRequest() = MerkpostenRequest(setNumber = setNumber, condition = zustand, ownerUserId = besitzer)

internal fun Teilerfassung.asRequest() = AddPartRequest(partNumber = nummer, colorId = farbId, colorName = farbname,
    colorHex = farbHex, quantity = menge, unitPrice = stueckpreis?.asDouble(), condition = zustand, ownerUserId = besitzer,
    storage = lagerort)

internal fun Figurenerfassung.asRequest() = AddMinifigRequest(figNumber = nummer, blFigNumber = blNumber, quantity = menge,
    unitPrice = stueckpreis?.asDouble(), condition = zustand, ownerUserId = besitzer, storage = lagerort)

internal fun Stueckaenderung.asRequest() = UpdateManualItemRequest(quantity = menge, quantityDelta = schritt,
    unitPrice = stueckpreis?.asDouble(), condition = zustand, blFigNumber = blNumber)

internal fun SetAggregate.asSummary() = Setzusammenfassung(setNumber = setNumber, zustand = condition,
    states = conditions, gebraucht = usedCount, highestPurchasePrice = maxPurchasePrice.asMoney(),
    purchasePriceCut = avgPurchasePrice.asMoney())
