package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.lokal.alsAnfrage
import ch.brickinventoryapp.model.fach.alsGeld
import ch.brickinventoryapp.model.fach.Stueckaenderung
import ch.brickinventoryapp.model.fach.Teilerfassung
import ch.brickinventoryapp.model.fach.Kategoriewahl
import ch.brickinventoryapp.model.fach.Farbwahl
import ch.brickinventoryapp.model.fach.Geld
import ch.brickinventoryapp.model.fach.Kontoauswahl
import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.data.api.TeileApi
import ch.brickinventoryapp.offline.Bearbeitung
import ch.brickinventoryapp.offline.Filterspalten
import ch.brickinventoryapp.offline.Faecher
import ch.brickinventoryapp.offline.Offlineablage.Nachzug
import ch.brickinventoryapp.model.lokal.Lokal
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
import ch.brickinventoryapp.model.fach.FarbeAnsicht
import ch.brickinventoryapp.model.fach.FilterFarbeAnsicht
import ch.brickinventoryapp.model.fach.KategorieAnsicht
import ch.brickinventoryapp.model.fach.LagerortAnsicht
import ch.brickinventoryapp.model.fach.LagerortEintragAnsicht
import ch.brickinventoryapp.model.fach.ManuellesTeilAnsicht
import ch.brickinventoryapp.model.fach.TeilAnsicht
import ch.brickinventoryapp.model.fach.TeilBestand
import ch.brickinventoryapp.model.fach.TeileKennzahlenAnsicht
import ch.brickinventoryapp.model.fach.Teilschluessel
import ch.brickinventoryapp.model.fach.VerwendungAnsicht
import ch.brickinventoryapp.model.fach.VorratsOrtAnsicht
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
    private val api: TeileApi,
    private val ablage: Offlineablage,
    private val wiederholung: Wiederholung,
) : TeileRepository {

    /** Die lokalen Listen nach den Filtern der Anzeige; sie ändern sich auch durch offline Bearbeitetes. */
    override fun beobachteTeile(suche: String?, farbe: Farbwahl, kategorie: Kategoriewahl, ersatzteile: Ersatzteilwahl): Flow<Lokal<TeilAnsicht>> =
        ablage.beobachte(Faecher.TEILE, Filterspalten(suchtext = suche?.ifBlank { null }, farbe = farbe.wert,
            kategorie = kategorie.wert, ersatzteil = ersatzteile.alsMerkmal()))

    override fun beobachteManuelleTeile(suche: String?): Flow<Lokal<ManuellesTeilAnsicht>> =
        ablage.beobachte(Faecher.MANUELLE_TEILE, Filterspalten(suchtext = suche?.ifBlank { null }))

    override suspend fun aktualisiereTeile(): Ergebnis<Unit> {
        val teile = ablage.aktualisiereSeitenweise(Faecher.TEILE, { r -> r.parts.map { it.alsAnsicht() } }, { it.total }, wiederholung) { seite ->
            sicherAufrufen { api.getParts(null, null, null, seite, pageSize = 500, excludeManual = "1") }
        }
        if (teile is Ergebnis.Error) return teile
        return aktualisiereManuelleTeile()
    }

    /** Eine Liste ohne Seiten: Die Gesamtzahl ist die Länge der Antwort. */
    override suspend fun aktualisiereManuelleTeile(): Ergebnis<Unit> =
        ablage.aktualisiereSeitenweise(Faecher.MANUELLE_TEILE, { r -> r.parts.map { it.alsAnsicht() } }, { it.parts.size }, wiederholung) { _ ->
            sicherAufrufen { api.getManualParts(null, null, null) }
        }

    override suspend fun getPartsStats(konten: Kontoauswahl?): Ergebnis<TeileKennzahlenAnsicht?> =
        sicherAufrufen { api.getPartsStats(konten?.anfrage) }.abgebildet { it.stats?.alsAnsicht() }

    /**
     * Die beiden Filterlisten des Teile-Reiters — Farbe und Kategorie. Ohne
     * Zwischenspeicher: Beide tragen Zählwerte, die sich mit jedem erfassten Teil
     * ändern; ein Cache zeigte Zahlen, die nicht zur Liste passen.
     */
    override suspend fun getPartsFilterColors(konten: Kontoauswahl?): Ergebnis<List<FilterFarbeAnsicht>> =
        sicherAufrufen { api.getPartsFilterColors(konten?.anfrage) }.zugesagt({ it.success }, { null }) { r -> r.colors.map { it.alsAnsicht() } }

    override suspend fun getPartsCategories(konten: Kontoauswahl?): Ergebnis<List<KategorieAnsicht>> =
        sicherAufrufen { api.getPartsCategories(konten?.anfrage) }.zugesagt({ it.success }, { null }) { r -> r.categories.map { it.alsAnsicht() } }

    /**
     * „Kann ich das bauen?“ — welche Teile einer Liste schon da sind. Ohne
     * Zwischenspeicher wie getSetsMitTeil(): Die Antwort hängt an einer frei
     * zusammengestellten Liste; ein Eintrag je Liste wäre ein Speicher, den niemand
     * ungültig macht, wenn ein Teil dazukommt.
     */
    override suspend fun getOwnedParts(teile: List<Teilschluessel>,
                              konten: Kontoauswahl?): Ergebnis<Map<Teilschluessel, TeilBestand>> =
        sicherAufrufen { api.getOwnedParts(BestandRequest(teile = teile.map { BestandTeil(it.nummer, it.farbe) }), konten?.anfrage) }
            .zugesagt({ it.success }) { r ->
                teile.mapNotNull { t -> r.bestand["${t.nummer}|${t.farbe}"]?.let { t to TeilBestand(it.gesamt, it.lose) } }.toMap()
            }

    /** Lagerort eines Teils setzen. Leerer Text loescht ihn. */
    override suspend fun setPartStorage(partNumber: String, colorId: Int, ort: String): Ergebnis<String?> =
        ablage.nachgezogen({ r -> Nachzug.TeilLagerort(partNumber, colorId, r.storage).takeIf { r.success } }) {
            sicherAufrufen { api.setPartStorage(partNumber, colorId, LagerortRequest(storage = ort)) }
        }.zugesagt({ it.success }) { it.storage }

    /**
     * Welche Lagerorte belegt sind. Ohne Zwischenspeicher: Die Liste ist klein und
     * ändert sich bei jedem Eintragen — ein Speicher liesse den gerade angelegten Ort
     * im Vorschlag fehlen.
     */
    override suspend fun getLagerorte(konten: Kontoauswahl?): Ergebnis<List<LagerortAnsicht>> =
        sicherAufrufen { api.getLagerorte(konten?.anfrage) }.zugesagt({ it.success }) { r -> r.orte.map { it.alsAnsicht() } }

    // ── Der Vorrat an Lagerorten ──
    //
    // Getrennt von getLagerorte(): Dort die belegten Orte (für den Filter), hier die
    // wählbaren (für Auswahlfeld und Einstellungen); ein frisch angelegter Ort steht
    // nur hier. Ohne Zwischenspeicher, weil sich die Liste genau dann ändert, wenn
    // jemand hier etwas einträgt.

    override fun beobachteLagerortVorrat(): Flow<Lokal<VorratsOrtAnsicht>> =
        ablage.beobachte(Faecher.LAGERORTE)

    /** Die Vorgabe kommt neben der Liste; in der Ablage trägt sie der Ort selbst. */
    override suspend fun aktualisiereLagerortVorrat(): Ergebnis<Unit> =
        ablage.aktualisiereSeitenweise(Faecher.LAGERORTE, { r -> r.orte.map { VorratsOrtAnsicht(ort = it.alsAnsicht(), vorgabe = it.id == r.vorgabe?.id) } },
            { it.orte.size }, wiederholung) { _ -> sicherAufrufen { api.getLagerortVorrat(null) } }

    override suspend fun getLagerortVorrat(besitzer: List<Int>): Ergebnis<List<LagerortEintragAnsicht>> =
        sicherAufrufen { api.getLagerortVorrat(besitzer.takeIf { it.isNotEmpty() }?.joinToString(",")) }
            .zugesagt({ it.success }) { r -> r.orte.map { it.alsAnsicht() } }

    override suspend fun legeLagerortAn(name: String): Ergebnis<Unit> =
        ablage.nachgezogen({ r -> r.ort?.takeIf { r.success }?.let { Nachzug.LagerortAngelegt(it.alsAnsicht()) } }) {
            sicherAufrufen { api.legeLagerortAn(LagerortNameRequest(name = name)) }
        }.zugesagt({ it.success }) { }

    override suspend fun benenneLagerortUm(id: Int, alt: String, name: String): Ergebnis<Unit> =
        ablage.nachgezogen({ r -> r.ort?.takeIf { r.success }?.let { Nachzug.LagerortUmbenannt(alt, it.alsAnsicht()) } }) {
            sicherAufrufen { api.benenneLagerortUm(id, LagerortNameRequest(name = name)) }
        }.zugesagt({ it.success }) { }

    override suspend fun loescheLagerort(id: Int): Ergebnis<Unit> =
        ablage.nachgezogen({ r -> Nachzug.LagerortGeloescht(id).takeIf { r.success } }) { sicherAufrufen { api.loescheLagerort(id) } }
            .zugesagt({ it.success }) { }

    /** Der vorausgewählte Lagerort (Stern) — `null` schaltet die Vorgabe ab; es gilt, was der Server meldet. */
    override suspend fun setzeLagerortVorgabe(id: Int?): Ergebnis<Unit> =
        ablage.nachgezogen({ r -> Nachzug.LagerortVorgabe(r.vorgabe?.id).takeIf { r.success } }) {
            sicherAufrufen { api.setzeLagerortVorgabe(LagerortVorgabeRequest(id = id)) }
        }.zugesagt({ it.success }) { }

    // ── In welchen Sets steckt dieses Teil / diese Figur? ──
    //
    // Für den Detail-Dialog. Ohne Zwischenspeicher: Die Antwort hängt an genau einem
    // Teil und wird auf Tastendruck geholt — ein Eintrag je Teil-Farb-Paar würde nie
    // ungültig, wenn ein Set dazukommt oder verschwindet.
    override suspend fun getSetsMitTeil(partNumber: String, colorId: Int,
                               konten: Kontoauswahl?): Ergebnis<VerwendungAnsicht> =
        sicherAufrufen { api.getSetsMitTeil(partNumber, colorId, konten?.anfrage) }.zugesagt({ it.success }) { it.alsAnsicht() }

    override suspend fun getBrickColors(): Ergebnis<List<FarbeAnsicht>> =
        sicherAufrufen { api.getBrickColors() }.zugesagt({ it.success }, { null }) { r -> r.colors.map { it.alsAnsicht() } }

    /** Ohne Farbe KEINE_FARBE, nie 0 (Schwarz); Name und Code gehören dann nicht dazu. */
    override suspend fun addPart(partNumber: String, colorId: Int, colorName: String?, colorHex: String?,
                         quantity: Int, unitPrice: Geld?,
                         condition: Zustand?, ownerUserId: Int?,
                         storage: String?): Ergebnis<Erfasst> {
        val ohne = colorId == KEINE_FARBE
        val erfassung = Teilerfassung(nummer = partNumber, farbId = colorId, farbname = colorName.takeUnless { ohne },
            farbHex = colorHex.takeUnless { ohne }, menge = quantity, stueckpreis = unitPrice, zustand = condition, besitzer = ownerUserId,
            lagerort = storage)
        val anfrage = erfassung.alsAnfrage()
        return ablage.schreibe(Bearbeitung.TeilErfassen(erfassung),
            { AddPartResponse(success = true, action = "gepuffert", partNumber = partNumber) }) { schluessel ->
            sicherAufrufen { api.addPart(anfrage, schluessel) }
        }.zugesagt({ it.success }) { Erfasst(it.action == "added", it.partNumber, it.priceFromCondition) }
    }

    /**
     * Die Menge reist auch als Schritt von der Menge, die die lokale Liste zeigt
     * (UpdateManualItemRequest.quantityDelta).
     *
     * @param owner Besitzer der Karte; null = eigenes Konto.
     */
    override suspend fun updatePart(partNumber: String, colorId: Int, quantity: Int, unitPrice: Double?, condition: Zustand?, owner: Int?): Ergebnis<Unit> {
        val bisher = ablage.lies(Faecher.MANUELLE_TEILE)?.liste
            ?.firstOrNull { it.partNumber == partNumber && it.colorId == colorId && (owner == null || it.userId == owner) }?.quantity
        val aenderung = Stueckaenderung(menge = quantity, schritt = bisher?.let { quantity - it }, stueckpreis = unitPrice.alsGeld(),
            zustand = condition)
        return ablage.schreibe(Bearbeitung.TeilAendern(partNumber, colorId, aenderung, owner), { GenericResponse(success = true) }) { schluessel ->
            sicherAufrufen { api.updatePart(partNumber, colorId, aenderung.alsAnfrage(), owner, schluessel) }
        }.erledigt()
    }

    /** Auch offline: Das Teil verschwindet sofort aus der Liste, der Server erfährt es später. */
    override suspend fun deletePart(partNumber: String, colorId: Int, owner: Int?): Ergebnis<Unit> =
        ablage.schreibe(Bearbeitung.TeilLoeschen(partNumber, colorId, owner), { GenericResponse(success = true) }) { schluessel ->
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
        return ablage.nachgezogen({ r -> Nachzug.TeilFarbe(partNumber, colorId, neueFarbe, name, hex, owner).takeIf { r.success } }) {
            sicherAufrufen { api.setPartColor(partNumber, colorId, TeilFarbeRequest(colorId = neueFarbe, colorName = name, colorHex = hex), owner) }
        }.zugesagt({ it.success }) { }
    }
}
