package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.fach.KontoAnsicht
import ch.brickinventoryapp.model.fach.ManuelleFigurAnsicht
import ch.brickinventoryapp.model.fach.ManuellesTeilAnsicht
import ch.brickinventoryapp.model.fach.MerkpostenAnsicht
import ch.brickinventoryapp.model.fach.PreisalarmAnsicht
import ch.brickinventoryapp.model.fach.SetAnsicht
import ch.brickinventoryapp.model.fach.Stueckaenderung
import ch.brickinventoryapp.model.fach.VorratsOrtAnsicht
import ch.brickinventoryapp.offline.Offlineablage.Nachzug
import ch.brickinventoryapp.offline.Offlineablage.Wirkung

/**
 * Wie eine Bearbeitung die lokale Liste ändert, bevor der Server sie gesehen
 * hat. Bewusst schlicht: Was der Server dazu rechnet (Preise, Namen), kommt mit
 * dem nächsten Abgleich; bis dahin zählt, dass Menge und Eintrag sichtbar sind.
 */
internal object LokaleAnwendung {

    fun sets(liste: List<SetAnsicht>, b: Wirkung): List<SetAnsicht> = when (b) {
        is Bearbeitung.SetMenge -> liste.mapNotNull {
            if (it.setNumber != b.setNumber) it
            else (it.quantity + b.schritt).takeIf { m -> m > 0 }?.let { m -> it.copy(quantity = m) }
        }
        is Bearbeitung.SetErfassen -> erfasst(liste, b)
        is Nachzug.MerkpostenUebernommen -> sets(liste, Bearbeitung.SetErfassen(b.wunsch))
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

    private fun erfasst(liste: List<SetAnsicht>, b: Bearbeitung.SetErfassen): List<SetAnsicht> {
        val a = b.wunsch
        if (liste.none { it.setNumber == a.setNumber })
            return listOf(SetAnsicht(setNumber = a.setNumber, quantity = a.menge, condition = a.zustand, storage = a.lagerort)) + liste
        return liste.map { if (it.setNumber == a.setNumber) it.copy(quantity = it.quantity + a.menge) else it }
    }

    /** Die Zusammenfassung ist vollständig: Ein Preis null heisst „keiner erfasst“, nicht „unbekannt“;
     * der abgelegte gälte sonst nach dem Löschen des letzten Kaufs weiter. */
    private fun zusammengefasst(s: SetAnsicht, b: Nachzug.SetZusammenfassung): SetAnsicht {
        val agg = b.agg
        return s.copy(condition = agg.zustand, conditions = agg.zustaende, usedCount = agg.gebraucht,
            maxPurchasePrice = agg.hoechsterKaufpreis, avgPurchasePrice = agg.kaufpreisSchnitt)
    }

    /** Den Namen des neuen Besitzers kennt erst der nächste Abgleich; bis dahin die Nummer ohne Namen. */
    private fun verschoben(s: SetAnsicht, b: Nachzug.SetVerschoben): SetAnsicht {
        if (s.owners.isEmpty()) return s
        val ohne = if (b.alle) s.owners.filterNot { it.id == b.von } else s.owners
        return s.copy(owners = if (ohne.any { it.id == b.zu }) ohne else ohne + KontoAnsicht(id = b.zu))
    }

    fun merkliste(liste: List<MerkpostenAnsicht>, b: Wirkung): List<MerkpostenAnsicht> = when (b) {
        is Bearbeitung.MerkpostenAnlegen -> {
            val a = b.wunsch
            val neu = MerkpostenAnsicht(setNumber = a.setNumber, condition = a.zustand, userId = a.besitzer ?: 0)
            if (liste.any { merkSchluessel(it) == merkSchluessel(neu) }) liste else listOf(neu) + liste
        }
        is Bearbeitung.MerkpostenLoeschen -> liste.filterNot {
            it.setNumber == b.setNumber && it.condition == b.zustand && (b.besitzer == null || it.userId == b.besitzer)
        }
        is Nachzug.MerkpostenUebernommen -> merkliste(liste, Bearbeitung.MerkpostenLoeschen(b.setNumber, b.zustand, b.besitzer))
        is Nachzug.MerkpostenVerschoben -> {
            val ziel = merkSchluessel(MerkpostenAnsicht(setNumber = b.setNumber, condition = b.zustand, userId = b.zu))
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

    fun manuelleTeile(liste: List<ManuellesTeilAnsicht>, b: Wirkung): List<ManuellesTeilAnsicht> = when (b) {
        is Bearbeitung.TeilErfassen -> teilErfasst(liste, b)
        is Bearbeitung.TeilAendern -> liste.map {
            if (it.partNumber == b.partNumber && it.colorId == b.colorId && (b.besitzer == null || it.userId == b.besitzer))
                it.copy(quantity = neueMenge(it.quantity, b.aenderung), unitPrice = b.aenderung.stueckpreis ?: it.unitPrice)
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

    private fun teilErfasst(liste: List<ManuellesTeilAnsicht>, b: Bearbeitung.TeilErfassen): List<ManuellesTeilAnsicht> {
        val a = b.erfassung
        fun gleich(p: ManuellesTeilAnsicht) = p.partNumber == a.nummer && p.colorId == a.farbId
        if (liste.none(::gleich))
            return listOf(ManuellesTeilAnsicht(partNumber = a.nummer, colorId = a.farbId, colorName = a.farbname,
                colorHex = a.farbHex, quantity = a.menge, unitPrice = a.stueckpreis, condition = a.zustand,
                userId = a.besitzer, storage = a.lagerort)) + liste
        return liste.map { if (gleich(it)) it.copy(quantity = it.quantity + a.menge) else it }
    }

    private fun umgefaerbt(liste: List<ManuellesTeilAnsicht>, b: Nachzug.TeilFarbe): List<ManuellesTeilAnsicht> {
        fun gemeint(p: ManuellesTeilAnsicht, farbe: Int) =
            p.partNumber == b.partNumber && p.colorId == farbe && (b.besitzer == null || p.userId == b.besitzer)
        val alt = liste.firstOrNull { gemeint(it, b.colorId) } ?: return liste
        val ziel = liste.firstOrNull { gemeint(it, b.neueFarbe) }
        if (ziel != null) return liste.filterNot { it === alt }.map { if (it === ziel) it.copy(quantity = it.quantity + alt.quantity) else it }
        return liste.map { if (it === alt) it.copy(colorId = b.neueFarbe, colorName = b.farbName, colorHex = b.farbHex) else it }
    }

    fun manuelleFiguren(liste: List<ManuelleFigurAnsicht>, b: Wirkung): List<ManuelleFigurAnsicht> = when (b) {
        is Bearbeitung.FigurErfassen -> {
            val a = b.erfassung
            if (liste.any { it.figNumber == a.nummer })
                liste.map { if (it.figNumber == a.nummer) it.copy(quantity = it.quantity + a.menge) else it }
            else listOf(ManuelleFigurAnsicht(figNumber = a.nummer, blFigNumber = a.blNummer, quantity = a.menge,
                unitPrice = a.stueckpreis, condition = a.zustand, userId = a.besitzer, storage = a.lagerort)) + liste
        }
        is Bearbeitung.FigurAendern -> liste.map {
            if (it.figNumber == b.figNumber && (b.besitzer == null || it.userId == b.besitzer))
                it.copy(quantity = neueMenge(it.quantity, b.aenderung), unitPrice = b.aenderung.stueckpreis ?: it.unitPrice)
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
    fun preisalarme(liste: List<PreisalarmAnsicht>, b: Wirkung): List<PreisalarmAnsicht> = when (b) {
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
    fun lagerorte(liste: List<VorratsOrtAnsicht>, b: Wirkung): List<VorratsOrtAnsicht> = when (b) {
        is Nachzug.LagerortAngelegt ->
            if (liste.any { it.ort.id == b.ort.id }) liste else liste + VorratsOrtAnsicht(ort = b.ort, vorgabe = false)
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
    private fun neueMenge(bisher: Int, a: Stueckaenderung) =
        a.schritt?.let { bisher + it } ?: a.menge

    fun merkSchluessel(m: MerkpostenAnsicht) = "${m.setNumber}|${m.condition.kennung}|${m.userId}"
}
