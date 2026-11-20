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
 * Der Set-Katalog des Servers — über Retrofit; die gemeinsame Abruflogik steht in Abruf.kt.
 */
@Singleton
class KatalogRepositoryImpl @Inject constructor(
    private val api: CatalogApi,
    private val ablage: Offlineablage,
    private val retry: Wiederholung,
) : CatalogRepository {
    /** Beim Blättern im Katalog: wenige Versuche, sonst stünde die nächste Seite lange aus. */
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
     * Jahresverteilung zu den aktuellen Filtern — die Zahlen, aus denen die
     * Leiste ihr Etikett rechnet. Einmal je Listenaufbau, nicht beim Rollen.
     */
    override suspend fun getCatalogYearVerteilung(
        q: String?, themeId: Int?, sort: Katalogsortierung
    ): Ergebnis<List<JahrAnzahlAnsicht>> =
        sicherAufrufen { api.getCatalogYearVerteilung(q, themeId, sort.kennung) }
            .promised({ it.success }, { null }) { r -> r.years.map { it.alsAnsicht() } }
}

private const val CATALOG_ATTEMPTS = 2
