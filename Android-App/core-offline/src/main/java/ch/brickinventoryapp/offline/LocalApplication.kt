package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.fach.AccountView
import ch.brickinventoryapp.model.fach.ManualMinifigView
import ch.brickinventoryapp.model.fach.ManualPartView
import ch.brickinventoryapp.model.fach.WantedItemView
import ch.brickinventoryapp.model.fach.PriceAlertView
import ch.brickinventoryapp.model.fach.SetAnsicht
import ch.brickinventoryapp.model.fach.Stueckaenderung
import ch.brickinventoryapp.model.fach.StockLocationView
import ch.brickinventoryapp.offline.Offlineablage.FollowUp
import ch.brickinventoryapp.offline.Offlineablage.Wirkung

/**
 * Wie eine Bearbeitung die lokale Liste ändert, bevor der Server sie gesehen
 * hat. Bewusst schlicht: Was der Server dazu rechnet (Preise, Namen), kommt mit
 * dem nächsten Abgleich; bis dahin zählt, dass Menge und Eintrag sichtbar sind.
 */
internal object LocalApplication {

    fun sets(liste: List<SetAnsicht>, b: Wirkung): List<SetAnsicht> = when (b) {
        is Editing.SetMenge -> liste.mapNotNull {
            if (it.setNumber != b.setNumber) it
            else (it.quantity + b.schritt).takeIf { m -> m > 0 }?.let { m -> it.copy(quantity = m) }
        }
        is Editing.SetErfassen -> erfasst(liste, b)
        is FollowUp.WantedItemAdopted -> sets(liste, Editing.SetErfassen(b.wish))
        is FollowUp.SetQuantitySet -> liste.mapNotNull {
            if (it.setNumber != b.setNumber) it else b.menge.takeIf { m -> m > 0 }?.let { m -> it.copy(quantity = m) }
        }
        is FollowUp.SetLocation -> liste.map { if (it.setNumber == b.setNumber) it.copy(storage = b.ort?.ifBlank { null }) else it }
        is FollowUp.SetRemoved -> liste.filterNot { it.setNumber == b.setNumber }
        is FollowUp.SetMoved -> liste.map { if (it.setNumber == b.setNumber) verschoben(it, b) else it }
        is FollowUp.SetSummary -> liste.map { if (it.setNumber == b.agg.setNumber) zusammengefasst(it, b) else it }
        is FollowUp.LocationRenamed -> liste.map { if (b.alt.isNotBlank() && it.storage == b.alt) it.copy(storage = b.neu.name) else it }
        is Editing.MerkpostenAnlegen, is Editing.MerkpostenLoeschen, is Editing.TeilErfassen,
        is Editing.TeilAendern, is Editing.TeilLoeschen, is Editing.FigurErfassen, is Editing.FigurAendern,
        is Editing.FigurLoeschen, is FollowUp.WantedItemMoved, is FollowUp.PartLocation, is FollowUp.PartColor,
        is FollowUp.MinifigLocation, is FollowUp.LocationCreated, is FollowUp.LocationDeleted, is FollowUp.LocationDefault,
        is FollowUp.AlarmSet, is FollowUp.AlarmRemoved -> liste
    }

    private fun erfasst(liste: List<SetAnsicht>, b: Editing.SetErfassen): List<SetAnsicht> {
        val a = b.wish
        if (liste.none { it.setNumber == a.setNumber })
            return listOf(SetAnsicht(setNumber = a.setNumber, quantity = a.menge, condition = a.zustand, storage = a.lagerort)) + liste
        return liste.map { if (it.setNumber == a.setNumber) it.copy(quantity = it.quantity + a.menge) else it }
    }

    /** Die Zusammenfassung ist vollständig: Ein Preis null heisst „keiner erfasst“, nicht „unbekannt“;
     * der abgelegte gälte sonst nach dem Löschen des letzten Kaufs weiter. */
    private fun zusammengefasst(s: SetAnsicht, b: FollowUp.SetSummary): SetAnsicht {
        val agg = b.agg
        return s.copy(condition = agg.zustand, conditions = agg.states, usedCount = agg.gebraucht,
            maxPurchasePrice = agg.highestPurchasePrice, avgPurchasePrice = agg.purchasePriceCut)
    }

    /** Den Namen des neuen Besitzers kennt erst der nächste Abgleich; bis dahin die Nummer ohne Namen. */
    private fun verschoben(s: SetAnsicht, b: FollowUp.SetMoved): SetAnsicht {
        if (s.owners.isEmpty()) return s
        val ohne = if (b.alle) s.owners.filterNot { it.id == b.von } else s.owners
        return s.copy(owners = if (ohne.any { it.id == b.zu }) ohne else ohne + AccountView(id = b.zu))
    }

    fun merkliste(liste: List<WantedItemView>, b: Wirkung): List<WantedItemView> = when (b) {
        is Editing.MerkpostenAnlegen -> {
            val a = b.wish
            val neu = WantedItemView(setNumber = a.setNumber, condition = a.zustand, userId = a.besitzer ?: 0)
            if (liste.any { rememberKey(it) == rememberKey(neu) }) liste else listOf(neu) + liste
        }
        is Editing.MerkpostenLoeschen -> liste.filterNot {
            it.setNumber == b.setNumber && it.condition == b.zustand && (b.besitzer == null || it.userId == b.besitzer)
        }
        is FollowUp.WantedItemAdopted -> merkliste(liste, Editing.MerkpostenLoeschen(b.setNumber, b.zustand, b.besitzer))
        is FollowUp.WantedItemMoved -> {
            val ziel = rememberKey(WantedItemView(setNumber = b.setNumber, condition = b.zustand, userId = b.zu))
            // Hatte das Ziel den Posten schon, fasst der Server zusammen: Es bleibt einer.
            val vorhanden = liste.any { rememberKey(it) == ziel }
            liste.mapNotNull {
                if (it.setNumber != b.setNumber || it.condition != b.zustand || it.userId != b.von) it
                else if (vorhanden) null else it.copy(userId = b.zu)
            }
        }
        is Editing.SetMenge, is Editing.SetErfassen, is Editing.TeilErfassen, is Editing.TeilAendern,
        is Editing.TeilLoeschen, is Editing.FigurErfassen, is Editing.FigurAendern, is Editing.FigurLoeschen,
        is FollowUp.SetQuantitySet, is FollowUp.SetLocation, is FollowUp.SetRemoved, is FollowUp.SetMoved,
        is FollowUp.SetSummary, is FollowUp.PartLocation, is FollowUp.PartColor, is FollowUp.MinifigLocation,
        is FollowUp.LocationRenamed, is FollowUp.LocationCreated, is FollowUp.LocationDeleted, is FollowUp.LocationDefault,
        is FollowUp.AlarmSet, is FollowUp.AlarmRemoved -> liste
    }

    fun manuelleTeile(liste: List<ManualPartView>, b: Wirkung): List<ManualPartView> = when (b) {
        is Editing.TeilErfassen -> partRecorded(liste, b)
        is Editing.TeilAendern -> liste.map {
            if (it.partNumber == b.partNumber && it.colorId == b.colorId && (b.besitzer == null || it.userId == b.besitzer))
                it.copy(quantity = newQuantity(it.quantity, b.aenderung), unitPrice = b.aenderung.stueckpreis ?: it.unitPrice)
            else it
        }
        is Editing.TeilLoeschen -> liste.filterNot {
            it.partNumber == b.partNumber && it.colorId == b.colorId && (b.besitzer == null || it.userId == b.besitzer)
        }
        is FollowUp.PartLocation -> liste.map {
            if (it.partNumber == b.partNumber && it.colorId == b.colorId) it.copy(storage = b.ort?.ifBlank { null }) else it
        }
        is FollowUp.PartColor -> recolored(liste, b)
        is FollowUp.LocationRenamed -> liste.map { if (b.alt.isNotBlank() && it.storage == b.alt) it.copy(storage = b.neu.name) else it }
        is Editing.SetMenge, is Editing.SetErfassen, is Editing.MerkpostenAnlegen,
        is Editing.MerkpostenLoeschen, is Editing.FigurErfassen, is Editing.FigurAendern,
        is Editing.FigurLoeschen, is FollowUp.SetQuantitySet, is FollowUp.SetLocation, is FollowUp.SetRemoved,
        is FollowUp.SetMoved, is FollowUp.SetSummary, is FollowUp.WantedItemMoved,
        is FollowUp.WantedItemAdopted, is FollowUp.MinifigLocation, is FollowUp.LocationCreated,
        is FollowUp.LocationDeleted, is FollowUp.LocationDefault, is FollowUp.AlarmSet, is FollowUp.AlarmRemoved -> liste
    }

    private fun partRecorded(liste: List<ManualPartView>, b: Editing.TeilErfassen): List<ManualPartView> {
        val a = b.erfassung
        fun gleich(p: ManualPartView) = p.partNumber == a.nummer && p.colorId == a.farbId
        if (liste.none(::gleich))
            return listOf(ManualPartView(partNumber = a.nummer, colorId = a.farbId, colorName = a.farbname,
                colorHex = a.farbHex, quantity = a.menge, unitPrice = a.stueckpreis, condition = a.zustand,
                userId = a.besitzer, storage = a.lagerort)) + liste
        return liste.map { if (gleich(it)) it.copy(quantity = it.quantity + a.menge) else it }
    }

    private fun recolored(liste: List<ManualPartView>, b: FollowUp.PartColor): List<ManualPartView> {
        fun gemeint(p: ManualPartView, farbe: Int) =
            p.partNumber == b.partNumber && p.colorId == farbe && (b.besitzer == null || p.userId == b.besitzer)
        val alt = liste.firstOrNull { gemeint(it, b.colorId) } ?: return liste
        val ziel = liste.firstOrNull { gemeint(it, b.neueFarbe) }
        if (ziel != null) return liste.filterNot { it === alt }.map { if (it === ziel) it.copy(quantity = it.quantity + alt.quantity) else it }
        return liste.map { if (it === alt) it.copy(colorId = b.neueFarbe, colorName = b.farbName, colorHex = b.farbHex) else it }
    }

    fun manualMinifigs(liste: List<ManualMinifigView>, b: Wirkung): List<ManualMinifigView> = when (b) {
        is Editing.FigurErfassen -> {
            val a = b.erfassung
            if (liste.any { it.figNumber == a.nummer })
                liste.map { if (it.figNumber == a.nummer) it.copy(quantity = it.quantity + a.menge) else it }
            else listOf(ManualMinifigView(figNumber = a.nummer, blFigNumber = a.blNumber, quantity = a.menge,
                unitPrice = a.stueckpreis, condition = a.zustand, userId = a.besitzer, storage = a.lagerort)) + liste
        }
        is Editing.FigurAendern -> liste.map {
            if (it.figNumber == b.figNumber && (b.besitzer == null || it.userId == b.besitzer))
                it.copy(quantity = newQuantity(it.quantity, b.aenderung), unitPrice = b.aenderung.stueckpreis ?: it.unitPrice)
            else it
        }
        is Editing.FigurLoeschen -> liste.filterNot {
            it.figNumber == b.figNumber && (b.besitzer == null || it.userId == b.besitzer)
        }
        is FollowUp.MinifigLocation -> liste.map { if (it.figNumber == b.figNumber) it.copy(storage = b.ort?.ifBlank { null }) else it }
        is FollowUp.LocationRenamed -> liste.map { if (b.alt.isNotBlank() && it.storage == b.alt) it.copy(storage = b.neu.name) else it }
        is Editing.SetMenge, is Editing.SetErfassen, is Editing.MerkpostenAnlegen,
        is Editing.MerkpostenLoeschen, is Editing.TeilErfassen, is Editing.TeilAendern,
        is Editing.TeilLoeschen, is FollowUp.SetQuantitySet, is FollowUp.SetLocation, is FollowUp.SetRemoved,
        is FollowUp.SetMoved, is FollowUp.SetSummary, is FollowUp.WantedItemMoved,
        is FollowUp.WantedItemAdopted, is FollowUp.PartLocation, is FollowUp.PartColor, is FollowUp.LocationCreated,
        is FollowUp.LocationDeleted, is FollowUp.LocationDefault, is FollowUp.AlarmSet, is FollowUp.AlarmRemoved -> liste
    }

    /** Ein gesetzter Alarm ersetzt den des Sets im selben Zustand; neue stehen vorn wie am Server. */
    fun preisalarme(liste: List<PriceAlertView>, b: Wirkung): List<PriceAlertView> = when (b) {
        is FollowUp.AlarmSet -> {
            val alt = liste.firstOrNull { it.setNumber == b.alarm.setNumber && it.condition == b.alarm.condition }
            // Die Einzelroute schickt weder Name noch Bild; die der Übersicht bleiben stehen.
            val neu = if (alt == null) b.alarm else b.alarm.copy(name = b.alarm.name ?: alt.name,
                imageLocal = b.alarm.imageLocal ?: alt.imageLocal, imageUrl = b.alarm.imageUrl ?: alt.imageUrl,
                setImgUrl = b.alarm.setImgUrl ?: alt.setImgUrl)
            if (alt == null) listOf(neu) + liste else liste.map { if (it === alt) neu else it }
        }
        is FollowUp.AlarmRemoved -> liste.filterNot { it.setNumber == b.setNumber && it.condition == b.zustand }
        is Editing, is FollowUp.SetQuantitySet, is FollowUp.SetLocation, is FollowUp.SetRemoved, is FollowUp.SetMoved,
        is FollowUp.SetSummary, is FollowUp.WantedItemMoved, is FollowUp.WantedItemAdopted,
        is FollowUp.PartLocation, is FollowUp.PartColor, is FollowUp.MinifigLocation, is FollowUp.LocationRenamed,
        is FollowUp.LocationCreated, is FollowUp.LocationDeleted, is FollowUp.LocationDefault -> liste
    }

    /** Der Vorrat folgt Anlegen, Umbenennen, Löschen und dem Stern; höchstens ein Ort trägt ihn. */
    fun lagerorte(liste: List<StockLocationView>, b: Wirkung): List<StockLocationView> = when (b) {
        is FollowUp.LocationCreated ->
            if (liste.any { it.ort.id == b.ort.id }) liste else liste + StockLocationView(ort = b.ort, vorgabe = false)
        is FollowUp.LocationRenamed -> liste.map { if (it.ort.id == b.neu.id) it.copy(ort = b.neu) else it }
        is FollowUp.LocationDeleted -> liste.filterNot { it.ort.id == b.id }
        is FollowUp.LocationDefault -> liste.map { it.copy(vorgabe = it.ort.id == b.id) }
        is Editing, is FollowUp.SetQuantitySet, is FollowUp.SetLocation, is FollowUp.SetRemoved, is FollowUp.SetMoved,
        is FollowUp.SetSummary, is FollowUp.WantedItemMoved, is FollowUp.WantedItemAdopted,
        is FollowUp.PartLocation, is FollowUp.PartColor, is FollowUp.MinifigLocation, is FollowUp.AlarmSet,
        is FollowUp.AlarmRemoved -> liste
    }

    /**
     * Mit Schritt zählt die Änderung auf das, was die Liste jetzt zeigt — auch
     * wenn eine neuere Serverantwort darunterliegt. Ohne Schritt gilt die Menge.
     */
    private fun newQuantity(bisher: Int, a: Stueckaenderung) =
        a.schritt?.let { bisher + it } ?: a.menge

    fun rememberKey(m: WantedItemView) = "${m.setNumber}|${m.condition.kennung}|${m.userId}"
}
