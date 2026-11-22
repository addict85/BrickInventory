package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.data.NetworkState.RetryPolicy
import ch.brickinventoryapp.data.api.CatalogApi
import ch.brickinventoryapp.model.domain.CatalogDetailView
import ch.brickinventoryapp.model.domain.CatalogMetaView
import ch.brickinventoryapp.model.domain.CatalogPageView
import ch.brickinventoryapp.model.domain.CatalogSort
import ch.brickinventoryapp.model.domain.YearCountView
import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.Slots
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The server's set catalog — via Retrofit; the common fetch logic stands in Fetch.kt.
 */
@Singleton
class CatalogRepositoryImpl @Inject constructor(
    private val api: CatalogApi,
    private val store: OfflineStore,
    private val retry: RetryPolicy,
) : CatalogRepository {
    /** When paging in the catalog: few attempts, otherwise the next page would be outstanding for long. */
    private val tight = retry.atMost(CATALOG_ATTEMPTS)

    override suspend fun getCatalogMeta(): Outcome<CatalogMetaView> =
        retry.retry {
            store.reconciledSingle(Slots.CATALOG_META) {
                safeCall { api.getCatalogMeta() }
                    .promised({ it.success }) { m -> CatalogMetaView(m.themes.map { it.asView() }, m.yearMin, m.yearMax) }
            }
        }

    override suspend fun getCatalogSets(
        q: String?, themeId: Int?, yearFrom: Int?, yearTo: Int?,
        sort: CatalogSort, page: Int, limit: Int
    ): Outcome<CatalogPageView> = tight.retry { safeCall { api.getCatalogSets(q, themeId, yearFrom, yearTo, sort.identifier, page, limit) } }
        .promised({ it.success }) { r -> CatalogPageView(r.sets.map { it.asView() }, r.total) }

    override suspend fun getCatalogSetDetail(setNumber: String): Outcome<CatalogDetailView?> =
        tight.retry { safeCall { api.getCatalogSetDetail(setNumber) } }
            .mapData { r -> r.set?.takeIf { r.success }?.asView() }

    /**
     * Year distribution for the current filters — the numbers from which the
     * bar computes its label. Once per list build, not while scrolling.
     */
    override suspend fun getCatalogYearDistribution(
        q: String?, themeId: Int?, sort: CatalogSort
    ): Outcome<List<YearCountView>> =
        safeCall { api.getCatalogYearDistribution(q, themeId, sort.identifier) }
            .promised({ it.success }, { null }) { r -> r.years.map { it.asView() } }
}

private const val CATALOG_ATTEMPTS = 2
