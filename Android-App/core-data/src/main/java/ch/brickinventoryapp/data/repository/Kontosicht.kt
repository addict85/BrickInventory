package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.data.api.FigurenApi
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.api.TeileApi
import ch.brickinventoryapp.data.api.alsAbfrage
import ch.brickinventoryapp.data.api.mitSetsAlsAbfrage
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.model.data.model.FigValuationItem
import ch.brickinventoryapp.model.data.model.Merkposten
import ch.brickinventoryapp.model.data.model.Minifig
import ch.brickinventoryapp.model.data.model.Part
import ch.brickinventoryapp.model.data.model.PartValuationItem
import ch.brickinventoryapp.model.data.model.SetItem
import ch.brickinventoryapp.model.fach.Merksortierung
import ch.brickinventoryapp.model.fach.Setsortierung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.lokal.Lokal
import ch.brickinventoryapp.offline.Fach
import ch.brickinventoryapp.offline.Faecher
import ch.brickinventoryapp.offline.Offlineablage
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Seitengrösse der Galerie, wie in der Webapp (public/js/02-gallery.js): Zwei
 * Grössen ergäben zwei Scroll-Erlebnisse für denselben Bestand.
 */
internal const val GALLERY_PAGE_SIZE = 60

/**
 * Die Sicht über gewählte Konten, Lagerorte oder mit „In Sets“: Mengen und
 * Preise je Konto teilt nur der Server auf, die lokale Zeile trägt die Summe
 * aller. Deshalb ein eigenes Lesemodell neben der Ablage, nicht ein zweiter
 * Weg zu denselben Listen.
 */
@Singleton
class Kontosicht @Inject constructor(
    private val sets: SetsApi,
    private val teile: TeileApi,
    private val figuren: FigurenApi,
    ablage: Offlineablage,
    private val wiederholung: Wiederholung,
) {
    /**
     * Ein Lesemodell, das nur der Server füllt: die zuletzt gefragte Liste im
     * Speicher, nie in Room. Ändert sich die Ablage ([ausloeser]), fragt es den
     * Server neu — ein Schreibvorgang zeigt sich so auch hier, ohne Signal.
     */
    class Serversicht<A, T>(
        private val ablage: Offlineablage,
        private val ausloeser: Array<Fach<*>>,
        private val uhr: () -> Long = System::currentTimeMillis,
        private val hole: suspend (A) -> Ergebnis<List<T>>,
    ) {
        private data class Eintrag<A, T>(val bereich: String, val abfrage: A, val liste: Lokal<T>)

        private val zuletzt = MutableStateFlow<Eintrag<A, T>?>(null)

        /** Nie geladen heisst Stand null, wie in der Ablage; eine Antwort für ein anderes Konto zählt nicht. */
        fun beobachte(abfrage: A): Flow<Lokal<T>> = channelFlow {
            launch { ablage.veraendert(*ausloeser).collectLatest { aktualisiere(abfrage) } }
            launch {
                zuletzt.map { e ->
                    if (e == null || e.abfrage != abfrage || e.bereich != ablage.bereich()) Lokal(emptyList(), null) else e.liste
                }.distinctUntilChanged().collect { send(it) }
            }
            awaitClose()
        }

        suspend fun aktualisiere(abfrage: A): Ergebnis<Unit> {
            val vorher = ablage.bereich() ?: return Ergebnis.Success(Unit)
            return when (val r = hole(abfrage)) {
                is Ergebnis.Success -> {
                    if (ablage.bereich() == vorher) zuletzt.value = Eintrag(vorher, abfrage, Lokal(r.data, uhr()))
                    Ergebnis.Success(Unit)
                }
                is Ergebnis.Error -> r
            }
        }
    }

    data class SetsAbfrage(val konten: String?, val suche: String?, val thema: String?,
                           val sort: Setsortierung?, val lagerort: String?)
    data class MerkAbfrage(val konten: String, val suche: String?, val zustand: Zustand?, val sort: Merksortierung?)
    data class TeileAbfrage(val konten: String?, val suche: String?, val farbe: String?, val kategorie: String?,
                            val ersatzteile: Ersatzteilwahl, val mitSets: Boolean, val lagerort: String?)
    data class ManuelleAbfrage(val konten: String?, val suche: String?, val lagerort: String?)
    data class FigurenAbfrage(val konten: String, val suche: String?)

    val galerie = Serversicht<SetsAbfrage, SetItem>(ablage, arrayOf(Faecher.SETS)) { a ->
        alleSeiten({ it.sets }, { it.setNumber }, { it.total }, wiederholung) { seite ->
            sicherAufrufen { sets.getSets(a.konten, a.suche, a.thema, a.sort?.kennung, seite, GALLERY_PAGE_SIZE, a.lagerort) }
        }
    }

    val merkliste = Serversicht<MerkAbfrage, Merkposten>(ablage, arrayOf(Faecher.MERKLISTE)) { a ->
        wiederholung.wiederhole {
            sicherAufrufen { sets.getMerkliste(a.suche, a.zustand?.kennung, a.sort?.kennung, a.konten) }
        }.map { it.merkposten }
    }

    val teileliste = Serversicht<TeileAbfrage, Part>(ablage, arrayOf(Faecher.TEILE)) { a ->
        alleSeiten({ it.parts }, { "${it.partNumber}|${it.colorId}|${it.isSpare}" }, { it.total }, wiederholung) { seite ->
            sicherAufrufen {
                teile.getParts(search = a.suche, color = a.farbe, category = a.kategorie, page = seite, pageSize = 500, excludeManual = "1", accounts = a.konten,
                    spare = a.ersatzteile.alsAbfrage(), withSets = mitSetsAlsAbfrage(a.mitSets), storage = a.lagerort)
            }
        }
    }

    val manuelleTeile = Serversicht<ManuelleAbfrage, PartValuationItem>(ablage, arrayOf(Faecher.MANUELLE_TEILE)) { a ->
        wiederholung.wiederhole { sicherAufrufen { teile.getManualParts(a.konten, a.suche, a.lagerort) } }.map { it.parts }
    }

    val figurenliste = Serversicht<FigurenAbfrage, Minifig>(ablage, arrayOf(Faecher.FIGUREN)) { a ->
        wiederholung.wiederhole {
            sicherAufrufen { figuren.getMinifigs(source = "set", accounts = a.konten, search = a.suche) }
        }.map { it.figs }
    }

    val manuelleFiguren = Serversicht<FigurenAbfrage, FigValuationItem>(ablage, arrayOf(Faecher.MANUELLE_FIGUREN)) { a ->
        wiederholung.wiederhole { sicherAufrufen { figuren.getManualMinifigs(a.konten, a.suche) } }.map { it.figs }
    }
}

private inline fun <T, R> Ergebnis<T>.map(f: (T) -> R): Ergebnis<R> = when (this) {
    is Ergebnis.Success -> Ergebnis.Success(f(data), stand, gepuffert)
    is Ergebnis.Error -> this
}
