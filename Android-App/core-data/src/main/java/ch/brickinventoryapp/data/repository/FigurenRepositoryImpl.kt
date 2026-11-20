package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.lokal.asRequest
import ch.brickinventoryapp.model.fach.asMoney
import ch.brickinventoryapp.model.fach.Stueckaenderung
import ch.brickinventoryapp.model.fach.Figurenerfassung
import ch.brickinventoryapp.model.fach.Geld
import ch.brickinventoryapp.model.fach.Kontoauswahl
import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.data.api.MinifigsApi
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.offline.Filterspalten
import ch.brickinventoryapp.offline.Slots
import ch.brickinventoryapp.offline.Offlineablage.FollowUp
import ch.brickinventoryapp.model.lokal.Local
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.vertrag.AddMinifigResponse
import ch.brickinventoryapp.vertrag.GenericResponse
import ch.brickinventoryapp.vertrag.LagerortRequest
import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht
import ch.brickinventoryapp.model.fach.Erfasst
import ch.brickinventoryapp.model.fach.FigurAnsicht
import ch.brickinventoryapp.model.fach.MinifigsMetricsView
import ch.brickinventoryapp.model.fach.ManualMinifigView
import ch.brickinventoryapp.model.fach.UsageView
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Minifiguren aus Sets und manuell erfasste — über Retrofit; die gemeinsame Abruflogik steht in Abruf.kt.
 */
@Singleton
class FigurenRepositoryImpl @Inject constructor(
    private val api: MinifigsApi,
    private val ablage: Offlineablage,
    private val retry: Wiederholung,
) : MinifigsRepository {

    /** Die lokalen Listen nach dem Suchtext, wie PartsRepository.observeParts. */
    override fun observeMinifigs(suche: String?): Flow<Local<FigurAnsicht>> =
        ablage.observe(Slots.FIGUREN, Filterspalten(suchtext = suche?.ifBlank { null }))

    override fun observeManualMinifigs(suche: String?): Flow<Local<ManualMinifigView>> =
        ablage.observe(Slots.MANUELLE_FIGUREN, Filterspalten(suchtext = suche?.ifBlank { null }))

    override suspend fun refreshMinifigs(): Ergebnis<Unit> {
        // Beide Listen kommen ganz, ohne Seiten: Die Gesamtzahl ist die Länge der Antwort.
        val figuren = ablage.refreshPaged(Slots.FIGUREN, { r -> r.figs.map { it.alsAnsicht() } }, { it.figs.size }, retry) { _ ->
            sicherAufrufen { api.getMinifigs(source = "set") }
        }
        if (figuren is Ergebnis.Fehler) return figuren
        return ablage.refreshPaged(Slots.MANUELLE_FIGUREN, { r -> r.figs.map { it.alsAnsicht() } }, { it.figs.size }, retry) { _ ->
            sicherAufrufen { api.getManualMinifigs(null, null) }
        }
    }

    /** Dasselbe fuer eine Minifigur — sie hat keine Farbe (Migration 0024). */
    override suspend fun setFigStorage(figNumber: String, ort: String): Ergebnis<String?> =
        ablage.nachgezogen({ r -> FollowUp.MinifigLocation(figNumber, r.storage).takeIf { r.success } }) {
            sicherAufrufen { api.setFigStorage(figNumber, LagerortRequest(storage = ort)) }
        }.promised({ it.success }) { it.storage }

    override suspend fun addMinifig(figNumber: String, blFigNumber: String?, quantity: Int,
                           unitPrice: Geld?, condition: Zustand?,
                           ownerUserId: Int?,
                           storage: String?): Ergebnis<Erfasst> =
        Figurenerfassung(nummer = figNumber, blNumber = blFigNumber, menge = quantity, stueckpreis = unitPrice, zustand = condition,
            besitzer = ownerUserId, lagerort = storage).let { erfassung ->
            val anfrage = erfassung.asRequest()
            ablage.schreibe(Editing.FigurErfassen(erfassung),
                { AddMinifigResponse(success = true, action = "gepuffert", figNumber = figNumber) }) { schluessel ->
                sicherAufrufen { api.addMinifig(anfrage, schluessel) }
            }.promised({ it.success }) { Erfasst(it.action == "added", it.figNumber, it.priceFromCondition) }
        }

    /**
     * Wie PartsRepository.updatePart: die Menge auch als Schritt.
     *
     * @param owner Besitzer der Karte; null = eigenes Konto.
     */
    override suspend fun updateMinifig(figNumber: String, quantity: Int, unitPrice: Double?, blFigNumber: String?, condition: Zustand?, owner: Int?): Ergebnis<Unit> {
        val bisher = ablage.lies(Slots.MANUELLE_FIGUREN)?.liste
            ?.firstOrNull { it.figNumber == figNumber && (owner == null || it.userId == owner) }?.quantity
        val aenderung = Stueckaenderung(menge = quantity, schritt = bisher?.let { quantity - it }, stueckpreis = unitPrice.asMoney(),
            zustand = condition, blNumber = blFigNumber)
        return ablage.schreibe(Editing.FigurAendern(figNumber, aenderung, owner), { GenericResponse(success = true) }) { schluessel ->
            sicherAufrufen { api.updateMinifig(figNumber, aenderung.asRequest(), owner, schluessel) }
        }.erledigt()
    }

    /** Auch offline, wie PartsRepository.deletePart. */
    override suspend fun deleteMinifig(figNumber: String, owner: Int?): Ergebnis<Unit> =
        ablage.schreibe(Editing.FigurLoeschen(figNumber, owner), { GenericResponse(success = true) }) { schluessel ->
            sicherAufrufen { api.deleteMinifig(figNumber, owner, schluessel) }
        }.erledigt()

    override suspend fun getMinifigStats(konten: Kontoauswahl?): Ergebnis<MinifigsMetricsView> =
        sicherAufrufen { api.getMinifigStats(konten?.anfrage) }.shown { it.stats.alsAnsicht() }

    override suspend fun getSetsWithMinifig(figNumber: String,
                                konten: Kontoauswahl?): Ergebnis<UsageView> =
        sicherAufrufen { api.getSetsWithMinifig(figNumber, konten?.anfrage) }.promised({ it.success }) { it.alsAnsicht() }
}
