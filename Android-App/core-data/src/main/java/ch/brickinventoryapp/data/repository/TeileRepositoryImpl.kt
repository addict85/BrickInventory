package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.local.asRequest
import ch.brickinventoryapp.model.domain.asMoney
import ch.brickinventoryapp.model.domain.Stueckaenderung
import ch.brickinventoryapp.model.domain.Teilerfassung
import ch.brickinventoryapp.model.domain.Kategoriewahl
import ch.brickinventoryapp.model.domain.ColorPicker
import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.Kontoauswahl
import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.data.api.PartsApi
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.offline.Filterspalten
import ch.brickinventoryapp.offline.Slots
import ch.brickinventoryapp.offline.Offlineablage.FollowUp
import ch.brickinventoryapp.model.local.Local
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.contract.BestandRequest
import ch.brickinventoryapp.contract.BestandTeil
import ch.brickinventoryapp.model.domain.Erfasst
import ch.brickinventoryapp.model.domain.KEINE_FARBE
import ch.brickinventoryapp.contract.LagerortNameRequest
import ch.brickinventoryapp.contract.LagerortRequest
import ch.brickinventoryapp.contract.LagerortVorgabeRequest
import ch.brickinventoryapp.contract.TeilFarbeRequest
import ch.brickinventoryapp.contract.mapping.alsAnsicht
import ch.brickinventoryapp.model.domain.ColorView
import ch.brickinventoryapp.model.domain.FilterColorView
import ch.brickinventoryapp.model.domain.CategoryView
import ch.brickinventoryapp.model.domain.LocationView
import ch.brickinventoryapp.model.domain.LocationEntryView
import ch.brickinventoryapp.model.domain.ManualPartView
import ch.brickinventoryapp.model.domain.TeilAnsicht
import ch.brickinventoryapp.model.domain.PartInventory
import ch.brickinventoryapp.model.domain.PartsMetricsView
import ch.brickinventoryapp.model.domain.PartialKey
import ch.brickinventoryapp.model.domain.UsageView
import ch.brickinventoryapp.model.domain.StockLocationView
import ch.brickinventoryapp.contract.AddPartResponse
import ch.brickinventoryapp.contract.GenericResponse
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton
import ch.brickinventoryapp.model.data.Ersatzteilwahl

/**
 * Parts, minifigures and colors — via Retrofit; the common fetch logic stands in Abruf.kt.
 */
@Singleton
class TeileRepositoryImpl @Inject constructor(
    private val api: PartsApi,
    private val ablage: Offlineablage,
    private val retry: Wiederholung,
) : PartsRepository {

    /** The local lists by the display's filters; they also change through things edited offline. */
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

    /** A list without pages: the total is the length of the response. */
    override suspend fun refreshManualParts(): Ergebnis<Unit> =
        ablage.refreshPaged(Slots.MANUELLE_TEILE, { r -> r.parts.map { it.alsAnsicht() } }, { it.parts.size }, retry) { _ ->
            sicherAufrufen { api.getManualParts(null, null, null) }
        }

    override suspend fun getPartsStats(konten: Kontoauswahl?): Ergebnis<PartsMetricsView?> =
        sicherAufrufen { api.getPartsStats(konten?.anfrage) }.shown { it.stats?.alsAnsicht() }

    /**
     * The two filter lists of the parts tab — color and category. Without
     * cache: both carry counts that change with every added part;
     * a cache would show numbers that do not match the list.
     */
    override suspend fun getPartsFilterColors(konten: Kontoauswahl?): Ergebnis<List<FilterColorView>> =
        sicherAufrufen { api.getPartsFilterColors(konten?.anfrage) }.promised({ it.success }, { null }) { r -> r.colors.map { it.alsAnsicht() } }

    override suspend fun getPartsCategories(konten: Kontoauswahl?): Ergebnis<List<CategoryView>> =
        sicherAufrufen { api.getPartsCategories(konten?.anfrage) }.promised({ it.success }, { null }) { r -> r.categories.map { it.alsAnsicht() } }

    /**
     * „Can I build this?“ — which parts of a list are already there. Without
     * cache like getSetsWithPart(): the response depends on a freely
     * assembled list; one entry per list would be a store nobody
     * invalidates when a part is added.
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
     * Which storage locations are occupied. Without cache: the list is small and
     * changes with every entry — a cache would let the location just created be missing
     * from the suggestion.
     */
    override suspend fun getLocations(konten: Kontoauswahl?): Ergebnis<List<LocationView>> =
        sicherAufrufen { api.getLocations(konten?.anfrage) }.promised({ it.success }) { r -> r.orte.map { it.alsAnsicht() } }

    // ── The supply of storage locations ──
    //
    // Separate from getLocations(): there the occupied locations (for the filter), here the
    // selectable ones (for select field and settings); a freshly created location stands
    // only here. Without cache, because the list changes exactly when
    // someone enters something here.

    override fun observeLocationStock(): Flow<Local<StockLocationView>> =
        ablage.observe(Slots.LAGERORTE)

    /** The default comes next to the list; in the store the location itself carries it. */
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

    /** The preselected storage location (star) — `null` switches the default off; what the server reports applies. */
    override suspend fun setLocationDefault(id: Int?): Ergebnis<Unit> =
        ablage.nachgezogen({ r -> FollowUp.LocationDefault(r.vorgabe?.id).takeIf { r.success } }) {
            sicherAufrufen { api.setLocationDefault(LagerortVorgabeRequest(id = id)) }
        }.promised({ it.success }) { }

    // ── In which sets is this part / this figure? ──
    //
    // For the detail dialog. Without cache: the response depends on exactly one
    // part and is fetched at the push of a button — one entry per part-color pair would never
    // become invalid when a set is added or disappears.
    override suspend fun getSetsWithPart(partNumber: String, colorId: Int,
                               konten: Kontoauswahl?): Ergebnis<UsageView> =
        sicherAufrufen { api.getSetsWithPart(partNumber, colorId, konten?.anfrage) }.promised({ it.success }) { it.alsAnsicht() }

    override suspend fun getBrickColors(): Ergebnis<List<ColorView>> =
        sicherAufrufen { api.getBrickColors() }.promised({ it.success }, { null }) { r -> r.colors.map { it.alsAnsicht() } }

    /** Without a color KEINE_FARBE, never 0 (black); name and code then do not belong to it. */
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
     * The quantity also travels as a step from the quantity the local list shows
     * (UpdateManualItemRequest.quantityDelta).
     *
     * @param owner owner of the card; null = own account.
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

    /** Offline too: the part disappears from the list immediately, the server learns of it later. */
    override suspend fun deletePart(partNumber: String, colorId: Int, owner: Int?): Ergebnis<Unit> =
        ablage.schreibe(Editing.TeilLoeschen(partNumber, colorId, owner), { GenericResponse(success = true) }) { schluessel ->
            sicherAufrufen { api.deletePart(partNumber, colorId, owner, schluessel) }
        }.erledigt()

    /**
     * Change the color of a manually added part afterwards.
     *
     * @param colorId   the old color — it says which row is meant.
     * @param neueFarbe the new color.
     * @param owner     owner of the card; null = own account.
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
