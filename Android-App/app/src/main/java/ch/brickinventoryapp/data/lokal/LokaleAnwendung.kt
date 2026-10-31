package ch.brickinventoryapp.data.lokal

import ch.brickinventoryapp.data.model.FigValuationItem
import ch.brickinventoryapp.data.model.Merkposten
import ch.brickinventoryapp.data.model.PartValuationItem
import ch.brickinventoryapp.data.model.SetItem

/**
 * Wie eine Bearbeitung die lokale Liste ändert, bevor der Server sie gesehen
 * hat. Bewusst schlicht: Was der Server dazu rechnet (Preise, Namen), kommt mit
 * dem nächsten Abgleich; bis dahin zählt, dass Menge und Eintrag sichtbar sind.
 */
internal object LokaleAnwendung {

    fun sets(liste: List<SetItem>, b: Bearbeitung): List<SetItem> = when (b) {
        is Bearbeitung.SetMenge -> liste.mapNotNull {
            if (it.setNumber != b.setNumber) it
            else (it.quantity + b.schritt).takeIf { m -> m > 0 }?.let { m -> it.copy(quantity = m) }
        }
        is Bearbeitung.SetErfassen -> {
            val a = b.anfrage
            if (liste.any { it.setNumber == a.setNumber })
                liste.map { if (it.setNumber == a.setNumber) it.copy(quantity = it.quantity + a.quantity) else it }
            else listOf(SetItem(setNumber = a.setNumber, quantity = a.quantity, condition = a.condition,
                storage = a.storage)) + liste
        }
        else -> liste
    }

    fun merkliste(liste: List<Merkposten>, b: Bearbeitung): List<Merkposten> = when (b) {
        is Bearbeitung.MerkpostenAnlegen -> {
            val a = b.anfrage
            val neu = Merkposten(setNumber = a.setNumber, condition = a.condition, userId = a.ownerUserId ?: 0)
            if (liste.any { merkSchluessel(it) == merkSchluessel(neu) }) liste else listOf(neu) + liste
        }
        is Bearbeitung.MerkpostenLoeschen -> liste.filterNot {
            it.setNumber == b.setNumber && it.condition == b.zustand && (b.besitzer == null || it.userId == b.besitzer)
        }
        else -> liste
    }

    fun manuelleTeile(liste: List<PartValuationItem>, b: Bearbeitung): List<PartValuationItem> = when (b) {
        is Bearbeitung.TeilErfassen -> {
            val a = b.anfrage
            if (liste.any { it.partNumber == a.partNumber && it.colorId == a.colorId })
                liste.map {
                    if (it.partNumber == a.partNumber && it.colorId == a.colorId) it.copy(quantity = it.quantity + a.quantity) else it
                }
            else listOf(PartValuationItem(partNumber = a.partNumber, colorId = a.colorId, colorName = a.colorName,
                colorHex = a.colorHex, quantity = a.quantity, unitPrice = a.unitPrice, condition = a.condition,
                userId = a.ownerUserId, storage = a.storage)) + liste
        }
        is Bearbeitung.TeilAendern -> liste.map {
            if (it.partNumber == b.partNumber && it.colorId == b.colorId && (b.besitzer == null || it.userId == b.besitzer))
                it.copy(quantity = b.anfrage.quantity, unitPrice = b.anfrage.unitPrice ?: it.unitPrice)
            else it
        }
        else -> liste
    }

    fun manuelleFiguren(liste: List<FigValuationItem>, b: Bearbeitung): List<FigValuationItem> = when (b) {
        is Bearbeitung.FigurErfassen -> {
            val a = b.anfrage
            if (liste.any { it.figNumber == a.figNumber })
                liste.map { if (it.figNumber == a.figNumber) it.copy(quantity = it.quantity + a.quantity) else it }
            else listOf(FigValuationItem(figNumber = a.figNumber, blFigNumber = a.blFigNumber, quantity = a.quantity,
                unitPrice = a.unitPrice, condition = a.condition, userId = a.ownerUserId, storage = a.storage)) + liste
        }
        is Bearbeitung.FigurAendern -> liste.map {
            if (it.figNumber == b.figNumber && (b.besitzer == null || it.userId == b.besitzer))
                it.copy(quantity = b.anfrage.quantity, unitPrice = b.anfrage.unitPrice ?: it.unitPrice)
            else it
        }
        else -> liste
    }

    fun merkSchluessel(m: Merkposten) = "${m.setNumber}|${m.condition}|${m.userId}"
}
