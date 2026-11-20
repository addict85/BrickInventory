package ch.brickinventoryapp.data.lokal

import ch.brickinventoryapp.model.fach.Erfassungswunsch
import ch.brickinventoryapp.model.fach.Figurenerfassung
import ch.brickinventoryapp.model.fach.Merkwunsch
import ch.brickinventoryapp.model.fach.Setzusammenfassung
import ch.brickinventoryapp.model.fach.Stueckaenderung
import ch.brickinventoryapp.model.fach.Teilerfassung
import ch.brickinventoryapp.model.fach.asMoney
import ch.brickinventoryapp.vertrag.AddMinifigRequest
import ch.brickinventoryapp.vertrag.AddPartRequest
import ch.brickinventoryapp.vertrag.AddSetRequest
import ch.brickinventoryapp.vertrag.MerkpostenRequest
import ch.brickinventoryapp.vertrag.SetAggregate
import ch.brickinventoryapp.vertrag.UpdateManualItemRequest

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
