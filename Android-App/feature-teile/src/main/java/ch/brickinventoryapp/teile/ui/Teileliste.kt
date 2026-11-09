package ch.brickinventoryapp.teile.ui

import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import ch.brickinventoryapp.model.data.model.BestandTeil
import ch.brickinventoryapp.model.data.model.Minifig
import ch.brickinventoryapp.model.data.model.Part
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.teile.ui.screens.comparePartNumbers
import ch.brickinventoryapp.teile.ui.screens.plColorCollator
import ch.brickinventoryapp.model.util.IMG_PROXY
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Inject

@Module
@InstallIn(SingletonComponent::class)
internal interface TeilelistenModul {
    @Binds fun quelle(t: Teileliste): TeilelistenQuelle
}

/**
 * Die temporäre Teileliste: Ein Set in seine Teile und Figuren auflösen und
 * den eigenen Bestand dazu holen. Ohne Zustand — die Liste hält
 * TeilelisteViewModel; hier stehen nur die Abläufe gegen die Repositories.
 */
internal class Teileliste @Inject constructor(
    private val sets: SetsRepository,
    private val teileRepo: TeileRepository,
) : TeilelistenQuelle {
    /** Name und Zeilen eines Sets; gleiche Teile (Rebrickable-Nummer + Farbe) zusammengefasst. */
    override suspend fun loeseSetAuf(setNumber: String, serverUrl: String): Pair<String, List<PlPart>> {
        return fangeAusserAbbruch {
            // Die CSV-Endpunkte hängen nicht am Konto und gehen für jedes Set.
            val partsResult = sets.getSetPartsList(setNumber)
            val figsResult  = sets.getSetMinifigsList(setNumber)
            // Der Name kommt aus dem Katalog (/sets/info), nicht aus dem eigenen
            // Bestand: In die Teileliste trägt man gerade Sets ein, die man nicht hat.
            val setName = (sets.getSetInfo(setNumber) as? Ergebnis.Success)
                ?.data?.name?.takeIf { it.isNotBlank() } ?: setNumber
            // Zusammengefasst wird nach der Rebrickable-Nummer, weil der Bestand
            // (mitBestand) danach gefragt wird. Mehrere Rebrickable-Teile teilen sich
            // oft eine BrickLink-Nummer; nach ihr zusammengefasst galt ein vorhandenes
            // Teil als fehlend. Angezeigt wird weiterhin die BrickLink-Nummer.
            val deduped = mutableMapOf<String, PlPart>()
            if (partsResult is Ergebnis.Success) {
                for (p in partsResult.data.parts) fasseZusammen(deduped, "${p.partNumber}|${p.colorId}", teilZeile(p, serverUrl))
            }
            // Figuren als Ganzes, nicht in ihre Teile zerlegt — wie in der Webapp.
            if (figsResult is Ergebnis.Success) {
                for (f in figsResult.data.figs) fasseZusammen(deduped, "fig:${f.figNumber}", figurZeile(f, serverUrl))
            }
            Pair(setName, deduped.values.toList())
        }.getOrElse { Pair(setNumber, listOf()) }
    }

    /** Eine Zeile unter [key] ablegen; gibt es sie schon, zählt nur die Menge dazu. */
    private fun fasseZusammen(deduped: MutableMap<String, PlPart>, key: String, zeile: PlPart) {
        val existing = deduped[key]
        deduped[key] = existing?.copy(quantity = existing.quantity + zeile.quantity) ?: zeile
    }

    private fun teilZeile(p: Part, serverUrl: String): PlPart {
        val blNum = p.blPartNumber ?: p.partNumber
        return PlPart(
            partNumber    = p.partNumber,
            blPartNumber  = blNum.takeIf { it != p.partNumber },
            partName      = p.partName ?: p.partNumber,
            colorName     = p.colorName ?: "",
            colorHex      = p.colorHex,
            colorId       = p.colorId,
            blColorId     = p.blColorId,
            quantity      = p.totalQuantity.takeIf { it > 0 } ?: 1,
            imageUrl      = bildUeberServer(serverUrl.trimEnd('/'), p.imageLocal, p.imageUrl),
            imageLocal    = p.imageLocal
        )
    }

    /**
     * Bilder immer über den Server: image_local und Pfade sind serverrelativ,
     * rohe CDN-Adressen brauchen die Kopfzeilen des Proxys.
     */
    private fun bildUeberServer(serverBase: String, imageLocal: String?, bild: String?): String? = when {
        imageLocal != null -> "$serverBase$imageLocal"
        bild == null -> null
        bild.startsWith("/") -> "$serverBase$bild"
        bild.startsWith("https://") || bild.startsWith("http://") ->
            // Noch nicht über den Server geleitet: Coil darf kein CDN direkt fragen.
            "$serverBase$IMG_PROXY?url=${java.net.URLEncoder.encode(bild, "UTF-8")}"
        else -> "$serverBase$bild"
    }

    private fun figurZeile(f: Minifig, serverUrl: String) = PlPart(
        partNumber   = f.figNumber,
        blPartNumber = f.figNumber,  // Figurennummern sind die BrickLink-Nummern
        partName     = f.figName ?: f.figNumber,
        colorName    = "Minifiguren",
        colorHex     = "f5a800",
        quantity     = f.totalQuantity?.takeIf { it > 0 } ?: f.quantity,
        imageUrl     = f.imageUrl?.let {
            if (it.startsWith("/")) "${serverUrl}$it" else it
        },
        isFig        = true
    )

    /**
     * „Kann ich das bauen?" — dieselbe Liste mit gesetztem `vorhanden`, oder
     * null bei einem Fehler. [nurLose] zählt nur Teile, die in keinem Set
     * stecken (sonst müsste man ein anderes Set zerlegen); [mitUnterkonten]
     * false fragt nur das eigene Konto.
     */
    override suspend fun mitBestand(
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
        val bestand = (antwort as? Ergebnis.Success)?.data?.takeIf { it.success }?.bestand ?: return null
        return teile.map { p ->
            val eintrag = bestand["${p.partNumber}|${p.colorId}"]
            p.copy(vorhanden = if (eintrag == null) 0 else if (nurLose) eintrag.lose else eintrag.gesamt)
        }
    }

    override fun sortiert(teile: Collection<PlPart>): List<PlPart> = teile.sortedWith { a, b ->
        val cmp = plColorCollator.compare(a.colorName, b.colorName)
        if (cmp != 0) cmp
        else comparePartNumbers(a.blPartNumber ?: a.partNumber, b.blPartNumber ?: b.partNumber)
    }
}
