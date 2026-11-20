package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.lokal.asRequest
import ch.brickinventoryapp.model.fach.asMoney
import ch.brickinventoryapp.model.fach.Stueckaenderung
import ch.brickinventoryapp.model.fach.Teilerfassung
import ch.brickinventoryapp.model.fach.Kategoriewahl
import ch.brickinventoryapp.model.fach.ColorPicker
import ch.brickinventoryapp.model.fach.Geld
import ch.brickinventoryapp.model.fach.Kontoauswahl
import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.data.api.PartsApi
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.offline.Filterspalten
import ch.brickinventoryapp.offline.Slots
import ch.brickinventoryapp.offline.Offlineablage.FollowUp
import ch.brickinventoryapp.model.lokal.Local
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.vertrag.BestandRequest
import ch.brickinventoryapp.vertrag.BestandTeil
import ch.brickinventoryapp.model.fach.Erfasst
import ch.brickinventoryapp.model.fach.KEINE_FARBE
import ch.brickinventoryapp.vertrag.LagerortNameRequest
import ch.brickinventoryapp.vertrag.LagerortRequest
import ch.brickinventoryapp.vertrag.LagerortVorgabeRequest
import ch.brickinventoryapp.vertrag.TeilFarbeRequest
import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht
import ch.brickinventoryapp.model.fach.ColorView
import ch.brickinventoryapp.model.fach.FilterColorView
import ch.brickinventoryapp.model.fach.CategoryView
import ch.brickinventoryapp.model.fach.LocationView
import ch.brickinventoryapp.model.fach.LocationEntryView
import ch.brickinventoryapp.model.fach.ManualPartView
import ch.brickinventoryapp.model.fach.TeilAnsicht
import ch.brickinventoryapp.model.fach.PartInventory
import ch.brickinventoryapp.model.fach.PartsMetricsView
import ch.brickinventoryapp.model.fach.PartialKey
import ch.brickinventoryapp.model.fach.UsageView
import ch.brickinventoryapp.model.fach.StockLocationView
import ch.brickinventoryapp.vertrag.AddPartResponse
import ch.brickinventoryapp.vertrag.GenericResponse
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton
import ch.brickinventoryapp.model.data.Ersatzteilwahl

/**
 * Teile, Minifiguren und Farben — über Retrofit; die gemeinsame Abruflogik steht in Abruf.kt.
 */
@Singleton
class TeileRepositoryImpl @Inject constructor(
    private val api: PartsApi,
    private val ablage: Offlineablage,
    private val retry: Wiederholung,
) : PartsRepository {

    /** Die lokalen Listen nach den Filtern der Anzeige; sie ändern sich auch durch offline Bearbeitetes. */
    override fun observeParts(suche: String?, farbe: ColorPicker, kategorie: Kategoriewahl, spareParts: Ersatzteilwahl): Flow<Local<TeilAnsicht>> =
        ablage.observe(Slots.TEILE, Filterspalten(suchtext = suche?.ifBlank { null }, farbe = farbe.wert,
            kategorie = kategorie.wert, ersatzteil = spareParts.asFeature()))

    override fun observeManualParts(suche: String?): Flow<Local<ManualPartView>> =
        ablage.observe(Slots.MANUELLE_TEILE, Filterspalten(suchtext = suche?.ifBlank { null }))

    override suspend fun refreshParts(): Ergebnis<Unit> {
        val teile = ablage.refreshPaged(Slots.TEILE, { r -> r.parts.map { it.alsAnsicht() } }, { it.total }, retry) { seite ->
            sicherAufrufen { api.getParts(null, null, null, seite, pageSize = 500, excludeManual = "1") }
        }
        if (teile is Ergebnis.Fehler) return teile
        return refreshManualParts()
    }

    /** Eine Liste ohne Seiten: Die Gesamtzahl ist die Länge der Antwort. */
    override suspend fun refreshManualParts(): Ergebnis<Unit> =
        ablage.refreshPaged(Slots.MANUELLE_TEILE, { r -> r.parts.map { it.alsAnsicht() } }, { it.parts.size }, retry) { _ ->
            sicherAufrufen { api.getManualParts(null, null, null) }
        }

    override suspend fun getPartsStats(konten: Kontoauswahl?): Ergebnis<PartsMetricsView?> =
        sicherAufrufen { api.getPartsStats(konten?.anfrage) }.shown { it.stats?.alsAnsicht() }

    /**
     * Die beiden Filterlisten des Teile-Reiters — Farbe und Kategorie. Ohne
     * Zwischenspeicher: Beide tragen Zählwerte, die sich mit jedem erfassten Teil
     * ändern; ein Cache zeigte Zahlen, die nicht zur Liste passen.
     */
    override suspend fun getPartsFilterColors(konten: Kontoauswahl?): Ergebnis<List<FilterColorView>> =
        sicherAufrufen { api.getPartsFilterColors(konten?.anfrage) }.promised({ it.success }, { null }) { r -> r.colors.map { it.alsAnsicht() } }

    override suspend fun getPartsCategories(konten: Kontoauswahl?): Ergebnis<List<CategoryView>> =
        sicherAufrufen { api.getPartsCategories(konten?.anfrage) }.promised({ it.success }, { null }) { r -> r.categories.map { it.alsAnsicht() } }

    /**
     * „Kann ich das bauen?“ — welche Teile einer Liste schon da sind. Ohne
     * Zwischenspeicher wie getSetsWithPart(): Die Antwort hängt an einer frei
     * zusammengestellten Liste; ein Eintrag je Liste wäre ein Speicher, den niemand
     * ungültig macht, wenn ein Teil dazukommt.
     */
    override suspend fun getOwnedParts(teile: List<PartialKey>,
                              konten: Kontoauswahl?): Ergebnis<Map<PartialKey, PartInventory>> =
        sicherAufrufen { api.getOwnedParts(BestandRequest(teile = teile.map { BestandTeil(it.nummer, it.farbe) }), konten?.anfrage) }
            .promised({ it.success }) { r ->
                teile.mapNotNull { t -> r.bestand["${t.nummer}|${t.farbe}"]?.let { t to PartInventory(it.gesamt, it.lose) } }.toMap()
            }

    /** Lagerort eines Teils setzen. Leerer Text loescht ihn. */
    override suspend fun setPartStorage(partNumber: String, colorId: Int, ort: String): Ergebnis<String?> =
        ablage.nachgezogen({ r -> FollowUp.PartLocation(partNumber, colorId, r.storage).takeIf { r.success } }) {
            sicherAufrufen { api.setPartStorage(partNumber, colorId, LagerortRequest(storage = ort)) }
        }.promised({ it.success }) { it.storage }

    /**
     * Welche Lagerorte belegt sind. Ohne Zwischenspeicher: Die Liste ist klein und
     * ändert sich bei jedem Eintragen — ein Speicher liesse den gerade angelegten Ort
     * im Vorschlag fehlen.
     */
    override suspend fun getLocations(konten: Kontoauswahl?): Ergebnis<List<LocationView>> =
        sicherAufrufen { api.getLocations(konten?.anfrage) }.promised({ it.success }) { r -> r.orte.map { it.alsAnsicht() } }

    // ── Der Vorrat an Lagerorten ──
    //
    // Getrennt von getLocations(): Dort die belegten Orte (für den Filter), hier die
    // wählbaren (für Auswahlfeld und Einstellungen); ein frisch angelegter Ort steht
    // nur hier. Ohne Zwischenspeicher, weil sich die Liste genau dann ändert, wenn
    // jemand hier etwas einträgt.

    override fun observeLocationStock(): Flow<Local<StockLocationView>> =
        ablage.observe(Slots.LAGERORTE)

    /** Die Vorgabe kommt neben der Liste; in der Ablage trägt sie der Ort selbst. */
    override suspend fun refreshLocationStock(): Ergebnis<Unit> =
        ablage.refreshPaged(Slots.LAGERORTE, { r -> r.orte.map { StockLocationView(ort = it.alsAnsicht(), vorgabe = it.id == r.vorgabe?.id) } },
            { it.orte.size }, retry) { _ -> sicherAufrufen { api.getLocationStock(null) } }

    override suspend fun getLocationStock(besitzer: List<Int>): Ergebnis<List<LocationEntryView>> =
        sicherAufrufen { api.getLocationStock(besitzer.takeIf { it.isNotEmpty() }?.joinToString(",")) }
            .promised({ it.success }) { r -> r.orte.map { it.alsAnsicht() } }

    override suspend fun putLocationAn(name: String): Ergebnis<Unit> =
        ablage.nachgezogen({ r -> r.ort?.takeIf { r.success }?.let { FollowUp.LocationCreated(it.alsAnsicht()) } }) {
            sicherAufrufen { api.putLocationAn(LagerortNameRequest(name = name)) }
        }.promised({ it.success }) { }

    override suspend fun nameLocationUm(id: Int, alt: String, name: String): Ergebnis<Unit> =
        ablage.nachgezogen({ r -> r.ort?.takeIf { r.success }?.let { FollowUp.LocationRenamed(alt, it.alsAnsicht()) } }) {
            sicherAufrufen { api.nameLocationUm(id, LagerortNameRequest(name = name)) }
        }.promised({ it.success }) { }

    override suspend fun deleteLocation(id: Int): Ergebnis<Unit> =
        ablage.nachgezogen({ r -> FollowUp.LocationDeleted(id).takeIf { r.success } }) { sicherAufrufen { api.deleteLocation(id) } }
            .promised({ it.success }) { }

    /** Der vorausgewählte Lagerort (Stern) — `null` schaltet die Vorgabe ab; es gilt, was der Server meldet. */
    override suspend fun setLocationDefault(id: Int?): Ergebnis<Unit> =
        ablage.nachgezogen({ r -> FollowUp.LocationDefault(r.vorgabe?.id).takeIf { r.success } }) {
            sicherAufrufen { api.setLocationDefault(LagerortVorgabeRequest(id = id)) }
        }.promised({ it.success }) { }

    // ── In welchen Sets steckt dieses Teil / diese Figur? ──
    //
    // Für den Detail-Dialog. Ohne Zwischenspeicher: Die Antwort hängt an genau einem
    // Teil und wird auf Tastendruck geholt — ein Eintrag je Teil-Farb-Paar würde nie
    // ungültig, wenn ein Set dazukommt oder verschwindet.
    override suspend fun getSetsWithPart(partNumber: String, colorId: Int,
                               konten: Kontoauswahl?): Ergebnis<UsageView> =
        sicherAufrufen { api.getSetsWithPart(partNumber, colorId, konten?.anfrage) }.promised({ it.success }) { it.alsAnsicht() }

    override suspend fun getBrickColors(): Ergebnis<List<ColorView>> =
        sicherAufrufen { api.getBrickColors() }.promised({ it.success }, { null }) { r -> r.colors.map { it.alsAnsicht() } }

    /** Ohne Farbe KEINE_FARBE, nie 0 (Schwarz); Name und Code gehören dann nicht dazu. */
    override suspend fun addPart(partNumber: String, colorId: Int, colorName: String?, colorHex: String?,
                         quantity: Int, unitPrice: Geld?,
                         condition: Zustand?, ownerUserId: Int?,
                         storage: String?): Ergebnis<Erfasst> {
        val ohne = colorId == KEINE_FARBE
        val erfassung = Teilerfassung(nummer = partNumber, farbId = colorId, farbname = colorName.takeUnless { ohne },
            farbHex = colorHex.takeUnless { ohne }, menge = quantity, stueckpreis = unitPrice, zustand = condition, besitzer = ownerUserId,
            lagerort = storage)
        val anfrage = erfassung.asRequest()
        return ablage.schreibe(Editing.TeilErfassen(erfassung),
            { AddPartResponse(success = true, action = "gepuffert", partNumber = partNumber) }) { schluessel ->
            sicherAufrufen { api.addPart(anfrage, schluessel) }
        }.promised({ it.success }) { Erfasst(it.action == "added", it.partNumber, it.priceFromCondition) }
    }

    /**
     * Die Menge reist auch als Schritt von der Menge, die die lokale Liste zeigt
     * (UpdateManualItemRequest.quantityDelta).
     *
     * @param owner Besitzer der Karte; null = eigenes Konto.
     */
    override suspend fun updatePart(partNumber: String, colorId: Int, quantity: Int, unitPrice: Double?, condition: Zustand?, owner: Int?): Ergebnis<Unit> {
        val bisher = ablage.lies(Slots.MANUELLE_TEILE)?.liste
            ?.firstOrNull { it.partNumber == partNumber && it.colorId == colorId && (owner == null || it.userId == owner) }?.quantity
        val aenderung = Stueckaenderung(menge = quantity, schritt = bisher?.let { quantity - it }, stueckpreis = unitPrice.asMoney(),
            zustand = condition)
        return ablage.schreibe(Editing.TeilAendern(partNumber, colorId, aenderung, owner), { GenericResponse(success = true) }) { schluessel ->
            sicherAufrufen { api.updatePart(partNumber, colorId, aenderung.asRequest(), owner, schluessel) }
        }.erledigt()
    }

    /** Auch offline: Das Teil verschwindet sofort aus der Liste, der Server erfährt es später. */
    override suspend fun deletePart(partNumber: String, colorId: Int, owner: Int?): Ergebnis<Unit> =
        ablage.schreibe(Editing.TeilLoeschen(partNumber, colorId, owner), { GenericResponse(success = true) }) { schluessel ->
            sicherAufrufen { api.deletePart(partNumber, colorId, owner, schluessel) }
        }.erledigt()

    /**
     * Die Farbe eines manuell erfassten Teils nachträglich ändern.
     *
     * @param colorId   die alte Farbe — sie sagt, welche Zeile gemeint ist.
     * @param neueFarbe die neue Farbe.
     * @param owner     Besitzer der Karte; null = eigenes Konto.
     */
    override suspend fun setPartColor(partNumber: String, colorId: Int, neueFarbe: Int,
                             farbName: String?, farbHex: String?,
                             owner: Int?): Ergebnis<Unit> {
        val name = farbName.takeUnless { neueFarbe == KEINE_FARBE }
        val hex = farbHex.takeUnless { neueFarbe == KEINE_FARBE }
        return ablage.nachgezogen({ r -> FollowUp.PartColor(partNumber, colorId, neueFarbe, name, hex, owner).takeIf { r.success } }) {
            sicherAufrufen { api.setPartColor(partNumber, colorId, TeilFarbeRequest(colorId = neueFarbe, colorName = name, colorHex = hex), owner) }
        }.promised({ it.success }) { }
    }
}
