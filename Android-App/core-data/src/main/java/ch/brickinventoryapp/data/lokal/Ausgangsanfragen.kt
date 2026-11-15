package ch.brickinventoryapp.data.lokal

import ch.brickinventoryapp.model.fach.Erfassungswunsch
import ch.brickinventoryapp.model.fach.Figurenerfassung
import ch.brickinventoryapp.model.fach.Merkwunsch
import ch.brickinventoryapp.model.fach.Setzusammenfassung
import ch.brickinventoryapp.model.fach.Stueckaenderung
import ch.brickinventoryapp.model.fach.Teilerfassung
import ch.brickinventoryapp.model.fach.alsGeld
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

internal fun Erfassungswunsch.alsAnfrage() = AddSetRequest(setNumber = setNumber, quantity = menge,
    purchasePrice = kaufpreis?.alsDouble(), condition = zustand, ownerUserId = besitzer, storage = lagerort)

internal fun Merkwunsch.alsAnfrage() = MerkpostenRequest(setNumber = setNumber, condition = zustand, ownerUserId = besitzer)

internal fun Teilerfassung.alsAnfrage() = AddPartRequest(partNumber = nummer, colorId = farbId, colorName = farbname,
    colorHex = farbHex, quantity = menge, unitPrice = stueckpreis?.alsDouble(), condition = zustand, ownerUserId = besitzer,
    storage = lagerort)

internal fun Figurenerfassung.alsAnfrage() = AddMinifigRequest(figNumber = nummer, blFigNumber = blNummer, quantity = menge,
    unitPrice = stueckpreis?.alsDouble(), condition = zustand, ownerUserId = besitzer, storage = lagerort)

internal fun Stueckaenderung.alsAnfrage() = UpdateManualItemRequest(quantity = menge, quantityDelta = schritt,
    unitPrice = stueckpreis?.alsDouble(), condition = zustand, blFigNumber = blNummer)

internal fun SetAggregate.alsZusammenfassung() = Setzusammenfassung(setNumber = setNumber, zustand = condition,
    zustaende = conditions, gebraucht = usedCount, hoechsterKaufpreis = maxPurchasePrice.alsGeld(),
    kaufpreisSchnitt = avgPurchasePrice.alsGeld())
