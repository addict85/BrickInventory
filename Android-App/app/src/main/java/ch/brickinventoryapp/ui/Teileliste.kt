package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.model.BestandTeil
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.ui.screens.PlPart
import ch.brickinventoryapp.util.IMG_PROXY

/**
 * Die temporäre Teileliste: Ein Set in seine Teile und Figuren auflösen und
 * den eigenen Bestand dazu holen. Ohne Zustand — die Liste selbst lebt bewusst
 * flüchtig im Bildschirm; hier stehen nur die Abläufe, damit sie ohne Gerät
 * prüfbar sind.
 */
internal class Teileliste(
    private val sets: SetsRepository,
    private val teileRepo: TeileRepository,
) {
    /** Name und Zeilen eines Sets; gleiche Teile (Rebrickable-Nummer + Farbe) zusammengefasst. */
    suspend fun loeseSetAuf(setNumber: String, serverUrl: String): Pair<String, List<PlPart>> {
        return try {
            // Die CSV-Endpunkte hängen nicht am Konto und gehen für jedes Set.
            val partsResult = sets.getSetPartsList(setNumber)
            val figsResult  = sets.getSetMinifigsList(setNumber)
            // Der Name kommt aus dem Katalog (/sets/info), nicht aus dem eigenen
            // Bestand: In die Teileliste trägt man gerade Sets ein, die man nicht hat.
            val setName = (sets.getSetInfo(setNumber) as? Result.Success)
                ?.data?.name?.takeIf { it.isNotBlank() } ?: setNumber
            // Zusammengefasst wird nach der Rebrickable-Nummer, weil der Bestand
            // (mitBestand) danach gefragt wird. Mehrere Rebrickable-Teile teilen sich
            // oft eine BrickLink-Nummer; nach ihr zusammengefasst galt ein vorhandenes
            // Teil als fehlend. Angezeigt wird weiterhin die BrickLink-Nummer.
            val deduped = mutableMapOf<String, PlPart>()
            if (partsResult is Result.Success) {
                val serverBase = serverUrl.trimEnd('/')
                for (p in partsResult.data.parts) {
                    val blNum = p.blPartNumber ?: p.partNumber
                    val key   = "${p.partNumber}|${p.colorId}"
                    val existing = deduped[key]
                    val qty = p.totalQuantity.takeIf { it > 0 } ?: 1
                    if (existing != null) {
                        deduped[key] = existing.copy(quantity = existing.quantity + qty)
                    } else {
                        // Bilder immer über den Server: image_local und Pfade sind serverrelativ,
                        // rohe CDN-Adressen brauchen die Kopfzeilen des Proxys.
                        val resolvedImageUrl = when {
                            p.imageLocal != null ->
                                "$serverBase${p.imageLocal}"
                            p.imageUrl == null -> null
                            p.imageUrl.startsWith("/") ->
                                "$serverBase${p.imageUrl}"
                            p.imageUrl.startsWith("https://") || p.imageUrl.startsWith("http://") ->
                                // Noch nicht über den Server geleitet: Coil darf kein CDN direkt fragen.
                                "$serverBase$IMG_PROXY?url=${java.net.URLEncoder.encode(p.imageUrl, "UTF-8")}"
                            else -> "$serverBase${p.imageUrl}"
                        }
                        deduped[key] = PlPart(
                            partNumber    = p.partNumber,
                            blPartNumber  = blNum.takeIf { it != p.partNumber },
                            partName      = p.partName ?: p.partNumber,
                            colorName     = p.colorName ?: "",
                            colorHex      = p.colorHex,
                            colorId       = p.colorId,
                            blColorId     = p.blColorId,
                            quantity      = qty,
                            imageUrl      = resolvedImageUrl,
                            imageLocal    = p.imageLocal
                        )
                    }
                }
            }
            // Figuren als Ganzes, nicht in ihre Teile zerlegt — wie in der Webapp.
            if (figsResult is Result.Success) {
                for (f in figsResult.data.figs) {
                    val figQty = f.totalQuantity?.takeIf { it > 0 } ?: f.quantity
                    val key = "fig:${f.figNumber}"
                    val existing = deduped[key]
                    if (existing != null) {
                        deduped[key] = existing.copy(quantity = existing.quantity + figQty)
                    } else {
                        deduped[key] = PlPart(
                            partNumber   = f.figNumber,
                            blPartNumber = f.figNumber,  // Figurennummern sind die BrickLink-Nummern
                            partName     = f.figName ?: f.figNumber,
                            colorName    = "Minifiguren",
                            colorHex     = "f5a800",
                            quantity     = figQty,
                            imageUrl     = f.imageUrl?.let {
                                if (it.startsWith("/")) "${serverUrl}$it" else it
                            },
                            isFig        = true
                        )
                    }
                }
            }
            Pair(setName, deduped.values.toList())
        } catch (e: Exception) { Pair(setNumber, listOf()) }
    }

    /**
     * „Kann ich das bauen?" — dieselbe Liste mit gesetztem `vorhanden`, oder
     * null bei einem Fehler. [nurLose] zählt nur Teile, die in keinem Set
     * stecken (sonst müsste man ein anderes Set zerlegen); [mitUnterkonten]
     * false fragt nur das eigene Konto.
     */
    suspend fun mitBestand(
        teile: List<PlPart>,
        nurLose: Boolean,
        mitUnterkonten: Boolean,
    ): List<PlPart>? {
        if (teile.isEmpty()) return teile
        // Gefragt wird in der REBRICKABLE-Schreibweise: Genau die steht auch in
        // der eigenen Teile-Tabelle. Die BrickLink-Nummer daneben ist fuer den
        // Export da und taugt fuer den Abgleich nicht.
        val anfrage = teile.map { BestandTeil(partNumber = it.partNumber, colorId = it.colorId) }
        // Das Blickfeld kommt aus dieser Ansicht, nicht aus dem Kontofilter des
        // Teile-Reiters. `null` heisst „alle Konten", "own" nur das eigene.
        val antwort = teileRepo.getOwnedParts(anfrage, if (mitUnterkonten) null else "own")
        val bestand = (antwort as? Result.Success)?.data?.takeIf { it.success }?.bestand ?: return null
        return teile.map { p ->
            val eintrag = bestand["${p.partNumber}|${p.colorId}"]
            p.copy(vorhanden = if (eintrag == null) 0 else if (nurLose) eintrag.lose else eintrag.gesamt)
        }
    }
}

