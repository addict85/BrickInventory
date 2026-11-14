package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.model.fach.Katalogsortierung
import ch.brickinventoryapp.data.api.KatalogApi
import ch.brickinventoryapp.offline.Faecher
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.model.data.model.CatalogMetaResponse
import ch.brickinventoryapp.model.data.model.CatalogSetDetailResponse
import ch.brickinventoryapp.model.data.model.CatalogSetsResponse
import javax.inject.Inject
import javax.inject.Singleton
import ch.brickinventoryapp.model.data.model.CatalogYearVerteilungResponse

/**
 * Der Set-Katalog des Servers — über Retrofit; die gemeinsame Abruflogik steht in Abruf.kt.
 */
@Singleton
class KatalogRepositoryImpl @Inject constructor(
    private val api: KatalogApi,
    private val ablage: Offlineablage,
    private val wiederholung: Wiederholung,
) : KatalogRepository {
    /** Beim Blättern im Katalog: wenige Versuche, sonst stünde die nächste Seite lange aus. */
    private val knapp = wiederholung.hoechstens(KATALOG_VERSUCHE)

    override suspend fun getCatalogMeta(): Ergebnis<CatalogMetaResponse> =
        wiederholung.wiederhole { ablage.abgeglichenEinzeln(Faecher.KATALOG_META) { sicherAufrufen { api.getCatalogMeta() } } }

    override suspend fun getCatalogSets(
        q: String?, themeId: Int?, yearFrom: Int?, yearTo: Int?,
        sort: Katalogsortierung, page: Int, limit: Int
    ): Ergebnis<CatalogSetsResponse> = knapp.wiederhole { sicherAufrufen { api.getCatalogSets(q, themeId, yearFrom, yearTo, sort.kennung, page, limit) } }

    override suspend fun getCatalogSetDetail(setNumber: String): Ergebnis<CatalogSetDetailResponse> =
        knapp.wiederhole { sicherAufrufen { api.getCatalogSetDetail(setNumber) } }

    /**
     * Jahresverteilung zu den aktuellen Filtern — die Zahlen, aus denen die
     * Leiste ihr Etikett rechnet. Einmal je Listenaufbau, nicht beim Rollen.
     */
    override suspend fun getCatalogYearVerteilung(
        q: String?, themeId: Int?, sort: Katalogsortierung
    ): Ergebnis<CatalogYearVerteilungResponse> =
        sicherAufrufen { api.getCatalogYearVerteilung(q, themeId, sort.kennung) }
}

private const val KATALOG_VERSUCHE = 2
