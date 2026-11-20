package ch.brickinventoryapp.teile.ui

import ch.brickinventoryapp.model.fach.Kontoauswahl
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import ch.brickinventoryapp.model.fach.FigurAnsicht
import ch.brickinventoryapp.model.fach.TeilAnsicht
import ch.brickinventoryapp.model.fach.PartialKey
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.SetKatalogRepository
import ch.brickinventoryapp.data.repository.PartsRepository
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
internal interface PartListsModule {
    @Binds fun quelle(t: Teileliste): PartListsSource
}

/**
 * Die temporäre Teileliste: Ein Set in seine Teile und Figuren auflösen und
 * den eigenen Bestand dazu holen. Ohne Zustand — die Liste hält
 * PartListViewModel; hier stehen nur die Abläufe gegen die Repositories.
 */
internal class Teileliste @Inject constructor(
    private val katalog: SetKatalogRepository,
    private val partsRepo: PartsRepository,
) : PartListsSource {
    /** Name und Zeilen eines Sets; gleiche Teile (Rebrickable-Nummer + Farbe) zusammengefasst. */
    override suspend fun resolveSetOn(setNumber: String, serverUrl: String): Pair<String, List<PlPart>> {
        return fangeAusserAbbruch {
            // Die CSV-Endpunkte hängen nicht am Konto und gehen für jedes Set.
            val partsResult = katalog.getSetPartsList(setNumber)
            val figsResult  = katalog.getSetMinifigsList(setNumber)
            // Der Name kommt aus dem Katalog (/sets/info), nicht aus dem eigenen
            // Bestand: In die Teileliste trägt man gerade Sets ein, die man nicht hat.
            val setName = (katalog.getSetInfo(setNumber) as? Ergebnis.Erfolg)
                ?.data?.takeIf { it.isNotBlank() } ?: setNumber
            // Zusammengefasst wird nach der Rebrickable-Nummer, weil der Bestand
            // (withInventory) danach gefragt wird. Mehrere Rebrickable-Teile teilen sich
            // oft eine BrickLink-Nummer; nach ihr zusammengefasst galt ein vorhandenes
            // Teil als fehlend. Angezeigt wird weiterhin die BrickLink-Nummer.
            val deduped = mutableMapOf<String, PlPart>()
            if (partsResult is Ergebnis.Erfolg) {
                for (p in partsResult.data) combineTogether(deduped, "${p.partNumber}|${p.colorId}", partRow(p, serverUrl))
            }
            // Figuren als Ganzes, nicht in ihre Teile zerlegt — wie in der Webapp.
            if (figsResult is Ergebnis.Erfolg) {
                for (f in figsResult.data) combineTogether(deduped, "fig:${f.figNumber}", minifigRow(f, serverUrl))
            }
            Pair(setName, deduped.values.toList())
        }.getOrElse { Pair(setNumber, listOf()) }
    }

    /** Eine Zeile unter [key] ablegen; gibt es sie schon, zählt nur die Menge dazu. */
    private fun combineTogether(deduped: MutableMap<String, PlPart>, key: String, zeile: PlPart) {
        val existing = deduped[key]
        deduped[key] = existing?.copy(quantity = existing.quantity + zeile.quantity) ?: zeile
    }

    private fun partRow(p: TeilAnsicht, serverUrl: String): PlPart {
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
            imageUrl      = imageViaServer(serverUrl.trimEnd('/'), p.imageLocal, p.imageUrl),
            imageLocal    = p.imageLocal
        )
    }

    /**
     * Bilder immer über den Server: image_local und Pfade sind serverrelativ,
     * rohe CDN-Adressen brauchen die Kopfzeilen des Proxys.
     */
    private fun imageViaServer(serverBase: String, imageLocal: String?, bild: String?): String? = when {
        imageLocal != null -> "$serverBase$imageLocal"
        bild == null -> null
        bild.startsWith("/") -> "$serverBase$bild"
        bild.startsWith("https://") || bild.startsWith("http://") ->
            // Noch nicht über den Server geleitet: Coil darf kein CDN direkt fragen.
            "$serverBase$IMG_PROXY?url=${java.net.URLEncoder.encode(bild, "UTF-8")}"
        else -> "$serverBase$bild"
    }

    private fun minifigRow(f: FigurAnsicht, serverUrl: String) = PlPart(
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
     * null bei einem Fehler. [onlyLose] zählt nur Teile, die in keinem Set
     * stecken (sonst müsste man ein anderes Set zerlegen); [withSubAccounts]
     * false fragt nur das eigene Konto.
     */
    override suspend fun withInventory(
        teile: List<PlPart>,
        onlyLose: Boolean,
        withSubAccounts: Boolean,
    ): List<PlPart>? {
        if (teile.isEmpty()) return teile
        // Gefragt wird in der REBRICKABLE-Schreibweise: Genau die steht auch in
        // der eigenen Teile-Tabelle. Die BrickLink-Nummer daneben ist fuer den
        // Export da und taugt fuer den Abgleich nicht.
        val anfrage = teile.map { PartialKey(nummer = it.partNumber, farbe = it.colorId) }
        // Das Blickfeld kommt aus dieser Ansicht, nicht aus dem Kontofilter des
        // Teile-Reiters. `null` heisst „alle Konten“.
        val antwort = partsRepo.getOwnedParts(anfrage, if (withSubAccounts) null else Kontoauswahl.Eigene)
        val bestand = (antwort as? Ergebnis.Erfolg)?.data ?: return null
        return teile.map { p ->
            val entry = bestand[PartialKey(p.partNumber, p.colorId)]
            p.copy(vorhanden = if (entry == null) 0 else if (onlyLose) entry.lose else entry.gesamt)
        }
    }

    override fun sortiert(teile: Collection<PlPart>): List<PlPart> = teile.sortedWith { a, b ->
        val cmp = plColorCollator.compare(a.colorName, b.colorName)
        if (cmp != 0) cmp
        else comparePartNumbers(a.blPartNumber ?: a.partNumber, b.blPartNumber ?: b.partNumber)
    }
}
