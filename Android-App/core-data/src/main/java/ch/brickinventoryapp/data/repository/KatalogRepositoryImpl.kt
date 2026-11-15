package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.JahrAnzahlAnsicht
import ch.brickinventoryapp.model.fach.KatalogDetailAnsicht
import ch.brickinventoryapp.model.fach.KatalogMetaAnsicht
import ch.brickinventoryapp.model.fach.KatalogSeiteAnsicht
import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht

import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.model.fach.Katalogsortierung
import ch.brickinventoryapp.data.api.KatalogApi
import ch.brickinventoryapp.offline.Faecher
import ch.brickinventoryapp.offline.Offlineablage
import javax.inject.Inject
import javax.inject.Singleton

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

    override suspend fun getCatalogMeta(): Ergebnis<KatalogMetaAnsicht> =
        wiederholung.wiederhole {
            ablage.abgeglichenEinzeln(Faecher.KATALOG_META) {
                sicherAufrufen { api.getCatalogMeta() }
                    .zugesagt({ it.success }, { it.error }) { m -> KatalogMetaAnsicht(m.themes.map { it.alsAnsicht() }, m.yearMin, m.yearMax) }
            }
        }

    override suspend fun getCatalogSets(
        q: String?, themeId: Int?, yearFrom: Int?, yearTo: Int?,
        sort: Katalogsortierung, page: Int, limit: Int
    ): Ergebnis<KatalogSeiteAnsicht> = knapp.wiederhole { sicherAufrufen { api.getCatalogSets(q, themeId, yearFrom, yearTo, sort.kennung, page, limit) } }
        .zugesagt({ it.success }, { it.error }) { r -> KatalogSeiteAnsicht(r.sets.map { it.alsAnsicht() }, r.total) }

    override suspend fun getCatalogSetDetail(setNumber: String): Ergebnis<KatalogDetailAnsicht?> =
        knapp.wiederhole { sicherAufrufen { api.getCatalogSetDetail(setNumber) } }
            .abgebildet { r -> r.set?.takeIf { r.success }?.alsAnsicht() }

    /**
     * Jahresverteilung zu den aktuellen Filtern — die Zahlen, aus denen die
     * Leiste ihr Etikett rechnet. Einmal je Listenaufbau, nicht beim Rollen.
     */
    override suspend fun getCatalogYearVerteilung(
        q: String?, themeId: Int?, sort: Katalogsortierung
    ): Ergebnis<List<JahrAnzahlAnsicht>> =
        sicherAufrufen { api.getCatalogYearVerteilung(q, themeId, sort.kennung) }
            .zugesagt({ it.success }, { null }) { r -> r.years.map { it.alsAnsicht() } }
}

private const val KATALOG_VERSUCHE = 2
