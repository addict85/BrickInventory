package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.domain.JahrAnzahlAnsicht
import ch.brickinventoryapp.model.domain.CatalogDetailView
import ch.brickinventoryapp.model.domain.CatalogMetaView
import ch.brickinventoryapp.model.domain.CatalogPageView
import ch.brickinventoryapp.contract.mapping.alsAnsicht

import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.model.domain.Katalogsortierung
import ch.brickinventoryapp.data.api.CatalogApi
import ch.brickinventoryapp.offline.Slots
import ch.brickinventoryapp.offline.Offlineablage
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The server's set catalog — via Retrofit; the common fetch logic stands in Abruf.kt.
 */
@Singleton
class KatalogRepositoryImpl @Inject constructor(
    private val api: CatalogApi,
    private val ablage: Offlineablage,
    private val retry: Wiederholung,
) : CatalogRepository {
    /** When paging in the catalog: few attempts, otherwise the next page would be outstanding for long. */
    private val tight = retry.atMost(CATALOG_ATTEMPTS)

    override suspend fun getCatalogMeta(): Ergebnis<CatalogMetaView> =
        retry.wiederhole {
            ablage.reconciledSingle(Slots.KATALOG_META) {
                sicherAufrufen { api.getCatalogMeta() }
                    .promised({ it.success }) { m -> CatalogMetaView(m.themes.map { it.alsAnsicht() }, m.yearMin, m.yearMax) }
            }
        }

    override suspend fun getCatalogSets(
        q: String?, themeId: Int?, yearFrom: Int?, yearTo: Int?,
        sort: Katalogsortierung, page: Int, limit: Int
    ): Ergebnis<CatalogPageView> = tight.wiederhole { sicherAufrufen { api.getCatalogSets(q, themeId, yearFrom, yearTo, sort.kennung, page, limit) } }
        .promised({ it.success }) { r -> CatalogPageView(r.sets.map { it.alsAnsicht() }, r.total) }

    override suspend fun getCatalogSetDetail(setNumber: String): Ergebnis<CatalogDetailView?> =
        tight.wiederhole { sicherAufrufen { api.getCatalogSetDetail(setNumber) } }
            .shown { r -> r.set?.takeIf { r.success }?.alsAnsicht() }

    /**
     * Year distribution for the current filters — the numbers from which the
     * bar computes its label. Once per list build, not while scrolling.
     */
    override suspend fun getCatalogYearVerteilung(
        q: String?, themeId: Int?, sort: Katalogsortierung
    ): Ergebnis<List<JahrAnzahlAnsicht>> =
        sicherAufrufen { api.getCatalogYearVerteilung(q, themeId, sort.kennung) }
            .promised({ it.success }, { null }) { r -> r.years.map { it.alsAnsicht() } }
}

private const val CATALOG_ATTEMPTS = 2
