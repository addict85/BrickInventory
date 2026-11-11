package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.data.model.FigValuationItem
import ch.brickinventoryapp.offline.Offlineablage.Nachzug
import ch.brickinventoryapp.offline.Offlineablage.Wirkung
import ch.brickinventoryapp.model.data.model.KontoName
import ch.brickinventoryapp.model.data.model.Merkposten
import ch.brickinventoryapp.model.data.model.PartValuationItem
import ch.brickinventoryapp.model.data.model.Preisalarm
import ch.brickinventoryapp.model.data.model.VorratsOrt
import ch.brickinventoryapp.model.data.model.SetItem
import ch.brickinventoryapp.model.data.model.UpdateManualItemRequest

/**
 * Wie eine Bearbeitung die lokale Liste ändert, bevor der Server sie gesehen
 * hat. Bewusst schlicht: Was der Server dazu rechnet (Preise, Namen), kommt mit
 * dem nächsten Abgleich; bis dahin zählt, dass Menge und Eintrag sichtbar sind.
 */
internal object LokaleAnwendung {

    fun sets(liste: List<SetItem>, b: Wirkung): List<SetItem> = when (b) {
        is Bearbeitung.SetMenge -> liste.mapNotNull {
            if (it.setNumber != b.setNumber) it
            else (it.quantity + b.schritt).takeIf { m -> m > 0 }?.let { m -> it.copy(quantity = m) }
        }
        is Bearbeitung.SetErfassen -> erfasst(liste, b)
        is Nachzug.MerkpostenUebernommen -> sets(liste, Bearbeitung.SetErfassen(b.anfrage))
        is Nachzug.SetMengeGesetzt -> liste.mapNotNull {
            if (it.setNumber != b.setNumber) it else b.menge.takeIf { m -> m > 0 }?.let { m -> it.copy(quantity = m) }
        }
        is Nachzug.SetLagerort -> liste.map { if (it.setNumber == b.setNumber) it.copy(storage = b.ort?.ifBlank { null }) else it }
        is Nachzug.SetEntfernt -> liste.filterNot { it.setNumber == b.setNumber }
        is Nachzug.SetVerschoben -> liste.map { if (it.setNumber == b.setNumber) verschoben(it, b) else it }
        is Nachzug.SetZusammenfassung -> liste.map { if (it.setNumber == b.agg.setNumber) zusammengefasst(it, b) else it }
        is Nachzug.LagerortUmbenannt -> liste.map { if (b.alt.isNotBlank() && it.storage == b.alt) it.copy(storage = b.neu.name) else it }
        is Bearbeitung.MerkpostenAnlegen, is Bearbeitung.MerkpostenLoeschen, is Bearbeitung.TeilErfassen,
        is Bearbeitung.TeilAendern, is Bearbeitung.TeilLoeschen, is Bearbeitung.FigurErfassen, is Bearbeitung.FigurAendern,
        is Bearbeitung.FigurLoeschen, is Nachzug.MerkpostenVerschoben, is Nachzug.TeilLagerort, is Nachzug.TeilFarbe,
        is Nachzug.FigurLagerort, is Nachzug.LagerortAngelegt, is Nachzug.LagerortGeloescht, is Nachzug.LagerortVorgabe,
        is Nachzug.AlarmGesetzt, is Nachzug.AlarmEntfernt -> liste
    }

    private fun erfasst(liste: List<SetItem>, b: Bearbeitung.SetErfassen): List<SetItem> {
        val a = b.anfrage
        if (liste.none { it.setNumber == a.setNumber })
            return listOf(SetItem(setNumber = a.setNumber, quantity = a.quantity, condition = a.condition, storage = a.storage)) + liste
        return liste.map { if (it.setNumber == a.setNumber) it.copy(quantity = it.quantity + a.quantity) else it }
    }

    /** Was die Zusammenfassung nicht kennt, bleibt wie abgelegt. */
    private fun zusammengefasst(s: SetItem, b: Nachzug.SetZusammenfassung): SetItem {
        val agg = b.agg
        return s.copy(condition = agg.condition ?: s.condition, conditions = agg.conditions.ifEmpty { s.conditions },
            usedCount = agg.usedCount ?: s.usedCount, maxPurchasePrice = agg.maxPurchasePrice ?: s.maxPurchasePrice,
            avgPurchasePrice = agg.avgPurchasePrice ?: s.avgPurchasePrice)
    }

    /** Den Namen des neuen Besitzers kennt erst der nächste Abgleich; bis dahin die Nummer ohne Namen. */
    private fun verschoben(s: SetItem, b: Nachzug.SetVerschoben): SetItem {
        if (s.owners.isEmpty()) return s
        val ohne = if (b.alle) s.owners.filterNot { it.id == b.von } else s.owners
        return s.copy(owners = if (ohne.any { it.id == b.zu }) ohne else ohne + KontoName(id = b.zu))
    }

    fun merkliste(liste: List<Merkposten>, b: Wirkung): List<Merkposten> = when (b) {
        is Bearbeitung.MerkpostenAnlegen -> {
            val a = b.anfrage
            val neu = Merkposten(setNumber = a.setNumber, condition = a.condition, userId = a.ownerUserId ?: 0)
            if (liste.any { merkSchluessel(it) == merkSchluessel(neu) }) liste else listOf(neu) + liste
        }
        is Bearbeitung.MerkpostenLoeschen -> liste.filterNot {
            it.setNumber == b.setNumber && it.condition == b.zustand && (b.besitzer == null || it.userId == b.besitzer)
        }
        is Nachzug.MerkpostenUebernommen -> merkliste(liste, Bearbeitung.MerkpostenLoeschen(b.setNumber, b.zustand, b.besitzer))
        is Nachzug.MerkpostenVerschoben -> {
            val ziel = merkSchluessel(Merkposten(setNumber = b.setNumber, condition = b.zustand, userId = b.zu))
            // Hatte das Ziel den Posten schon, fasst der Server zusammen: Es bleibt einer.
            val vorhanden = liste.any { merkSchluessel(it) == ziel }
            liste.mapNotNull {
                if (it.setNumber != b.setNumber || it.condition != b.zustand || it.userId != b.von) it
                else if (vorhanden) null else it.copy(userId = b.zu)
            }
        }
        is Bearbeitung.SetMenge, is Bearbeitung.SetErfassen, is Bearbeitung.TeilErfassen, is Bearbeitung.TeilAendern,
        is Bearbeitung.TeilLoeschen, is Bearbeitung.FigurErfassen, is Bearbeitung.FigurAendern, is Bearbeitung.FigurLoeschen,
        is Nachzug.SetMengeGesetzt, is Nachzug.SetLagerort, is Nachzug.SetEntfernt, is Nachzug.SetVerschoben,
        is Nachzug.SetZusammenfassung, is Nachzug.TeilLagerort, is Nachzug.TeilFarbe, is Nachzug.FigurLagerort,
        is Nachzug.LagerortUmbenannt, is Nachzug.LagerortAngelegt, is Nachzug.LagerortGeloescht, is Nachzug.LagerortVorgabe,
        is Nachzug.AlarmGesetzt, is Nachzug.AlarmEntfernt -> liste
    }

    fun manuelleTeile(liste: List<PartValuationItem>, b: Wirkung): List<PartValuationItem> = when (b) {
        is Bearbeitung.TeilErfassen -> teilErfasst(liste, b)
        is Bearbeitung.TeilAendern -> liste.map {
            if (it.partNumber == b.partNumber && it.colorId == b.colorId && (b.besitzer == null || it.userId == b.besitzer))
                it.copy(quantity = neueMenge(it.quantity, b.anfrage), unitPrice = b.anfrage.unitPrice ?: it.unitPrice)
            else it
        }
        is Bearbeitung.TeilLoeschen -> liste.filterNot {
            it.partNumber == b.partNumber && it.colorId == b.colorId && (b.besitzer == null || it.userId == b.besitzer)
        }
        is Nachzug.TeilLagerort -> liste.map {
            if (it.partNumber == b.partNumber && it.colorId == b.colorId) it.copy(storage = b.ort?.ifBlank { null }) else it
        }
        is Nachzug.TeilFarbe -> umgefaerbt(liste, b)
        is Nachzug.LagerortUmbenannt -> liste.map { if (b.alt.isNotBlank() && it.storage == b.alt) it.copy(storage = b.neu.name) else it }
        is Bearbeitung.SetMenge, is Bearbeitung.SetErfassen, is Bearbeitung.MerkpostenAnlegen,
        is Bearbeitung.MerkpostenLoeschen, is Bearbeitung.FigurErfassen, is Bearbeitung.FigurAendern,
        is Bearbeitung.FigurLoeschen, is Nachzug.SetMengeGesetzt, is Nachzug.SetLagerort, is Nachzug.SetEntfernt,
        is Nachzug.SetVerschoben, is Nachzug.SetZusammenfassung, is Nachzug.MerkpostenVerschoben,
        is Nachzug.MerkpostenUebernommen, is Nachzug.FigurLagerort, is Nachzug.LagerortAngelegt,
        is Nachzug.LagerortGeloescht, is Nachzug.LagerortVorgabe, is Nachzug.AlarmGesetzt, is Nachzug.AlarmEntfernt -> liste
    }

    private fun teilErfasst(liste: List<PartValuationItem>, b: Bearbeitung.TeilErfassen): List<PartValuationItem> {
        val a = b.anfrage
        fun gleich(p: PartValuationItem) = p.partNumber == a.partNumber && p.colorId == a.colorId
        if (liste.none(::gleich))
            return listOf(PartValuationItem(partNumber = a.partNumber, colorId = a.colorId, colorName = a.colorName,
                colorHex = a.colorHex, quantity = a.quantity, unitPrice = a.unitPrice, condition = a.condition,
                userId = a.ownerUserId, storage = a.storage)) + liste
        return liste.map { if (gleich(it)) it.copy(quantity = it.quantity + a.quantity) else it }
    }

    private fun umgefaerbt(liste: List<PartValuationItem>, b: Nachzug.TeilFarbe): List<PartValuationItem> {
        fun gemeint(p: PartValuationItem, farbe: Int) =
            p.partNumber == b.partNumber && p.colorId == farbe && (b.besitzer == null || p.userId == b.besitzer)
        val alt = liste.firstOrNull { gemeint(it, b.colorId) } ?: return liste
        val ziel = liste.firstOrNull { gemeint(it, b.neueFarbe) }
        if (ziel != null) return liste.filterNot { it === alt }.map { if (it === ziel) it.copy(quantity = it.quantity + alt.quantity) else it }
        return liste.map { if (it === alt) it.copy(colorId = b.neueFarbe, colorName = b.farbName, colorHex = b.farbHex) else it }
    }

    fun manuelleFiguren(liste: List<FigValuationItem>, b: Wirkung): List<FigValuationItem> = when (b) {
        is Bearbeitung.FigurErfassen -> {
            val a = b.anfrage
            if (liste.any { it.figNumber == a.figNumber })
                liste.map { if (it.figNumber == a.figNumber) it.copy(quantity = it.quantity + a.quantity) else it }
            else listOf(FigValuationItem(figNumber = a.figNumber, blFigNumber = a.blFigNumber, quantity = a.quantity,
                unitPrice = a.unitPrice, condition = a.condition, userId = a.ownerUserId, storage = a.storage)) + liste
        }
        is Bearbeitung.FigurAendern -> liste.map {
            if (it.figNumber == b.figNumber && (b.besitzer == null || it.userId == b.besitzer))
                it.copy(quantity = neueMenge(it.quantity, b.anfrage), unitPrice = b.anfrage.unitPrice ?: it.unitPrice)
            else it
        }
        is Bearbeitung.FigurLoeschen -> liste.filterNot {
            it.figNumber == b.figNumber && (b.besitzer == null || it.userId == b.besitzer)
        }
        is Nachzug.FigurLagerort -> liste.map { if (it.figNumber == b.figNumber) it.copy(storage = b.ort?.ifBlank { null }) else it }
        is Nachzug.LagerortUmbenannt -> liste.map { if (b.alt.isNotBlank() && it.storage == b.alt) it.copy(storage = b.neu.name) else it }
        is Bearbeitung.SetMenge, is Bearbeitung.SetErfassen, is Bearbeitung.MerkpostenAnlegen,
        is Bearbeitung.MerkpostenLoeschen, is Bearbeitung.TeilErfassen, is Bearbeitung.TeilAendern,
        is Bearbeitung.TeilLoeschen, is Nachzug.SetMengeGesetzt, is Nachzug.SetLagerort, is Nachzug.SetEntfernt,
        is Nachzug.SetVerschoben, is Nachzug.SetZusammenfassung, is Nachzug.MerkpostenVerschoben,
        is Nachzug.MerkpostenUebernommen, is Nachzug.TeilLagerort, is Nachzug.TeilFarbe, is Nachzug.LagerortAngelegt,
        is Nachzug.LagerortGeloescht, is Nachzug.LagerortVorgabe, is Nachzug.AlarmGesetzt, is Nachzug.AlarmEntfernt -> liste
    }

    /** Ein gesetzter Alarm ersetzt den des Sets im selben Zustand; neue stehen vorn wie am Server. */
    fun preisalarme(liste: List<Preisalarm>, b: Wirkung): List<Preisalarm> = when (b) {
        is Nachzug.AlarmGesetzt -> {
            val alt = liste.firstOrNull { it.setNumber == b.alarm.setNumber && it.condition == b.alarm.condition }
            // Die Einzelroute schickt weder Name noch Bild; die der Übersicht bleiben stehen.
            val neu = if (alt == null) b.alarm else b.alarm.copy(name = b.alarm.name ?: alt.name,
                imageLocal = b.alarm.imageLocal ?: alt.imageLocal, imageUrl = b.alarm.imageUrl ?: alt.imageUrl,
                setImgUrl = b.alarm.setImgUrl ?: alt.setImgUrl)
            if (alt == null) listOf(neu) + liste else liste.map { if (it === alt) neu else it }
        }
        is Nachzug.AlarmEntfernt -> liste.filterNot { it.setNumber == b.setNumber && it.condition == b.zustand }
        is Bearbeitung, is Nachzug.SetMengeGesetzt, is Nachzug.SetLagerort, is Nachzug.SetEntfernt, is Nachzug.SetVerschoben,
        is Nachzug.SetZusammenfassung, is Nachzug.MerkpostenVerschoben, is Nachzug.MerkpostenUebernommen,
        is Nachzug.TeilLagerort, is Nachzug.TeilFarbe, is Nachzug.FigurLagerort, is Nachzug.LagerortUmbenannt,
        is Nachzug.LagerortAngelegt, is Nachzug.LagerortGeloescht, is Nachzug.LagerortVorgabe -> liste
    }

    /** Der Vorrat folgt Anlegen, Umbenennen, Löschen und dem Stern; höchstens ein Ort trägt ihn. */
    fun lagerorte(liste: List<VorratsOrt>, b: Wirkung): List<VorratsOrt> = when (b) {
        is Nachzug.LagerortAngelegt ->
            if (liste.any { it.ort.id == b.ort.id }) liste else liste + VorratsOrt(b.ort, vorgabe = false)
        is Nachzug.LagerortUmbenannt -> liste.map { if (it.ort.id == b.neu.id) it.copy(ort = b.neu) else it }
        is Nachzug.LagerortGeloescht -> liste.filterNot { it.ort.id == b.id }
        is Nachzug.LagerortVorgabe -> liste.map { it.copy(vorgabe = it.ort.id == b.id) }
        is Bearbeitung, is Nachzug.SetMengeGesetzt, is Nachzug.SetLagerort, is Nachzug.SetEntfernt, is Nachzug.SetVerschoben,
        is Nachzug.SetZusammenfassung, is Nachzug.MerkpostenVerschoben, is Nachzug.MerkpostenUebernommen,
        is Nachzug.TeilLagerort, is Nachzug.TeilFarbe, is Nachzug.FigurLagerort, is Nachzug.AlarmGesetzt,
        is Nachzug.AlarmEntfernt -> liste
    }

    /**
     * Mit Schritt zählt die Änderung auf das, was die Liste jetzt zeigt — auch
     * wenn eine neuere Serverantwort darunterliegt. Ohne Schritt gilt die Menge.
     */
    private fun neueMenge(bisher: Int, a: UpdateManualItemRequest) =
        a.quantityDelta?.let { bisher + it } ?: a.quantity

    fun merkSchluessel(m: Merkposten) = "${m.setNumber}|${m.condition.kennung}|${m.userId}"
}
