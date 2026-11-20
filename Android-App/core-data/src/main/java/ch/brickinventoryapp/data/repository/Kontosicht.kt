package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.domain.Kategoriewahl
import ch.brickinventoryapp.model.domain.ColorPicker
import ch.brickinventoryapp.model.domain.WantedItemView
import ch.brickinventoryapp.model.domain.SetAnsicht
import ch.brickinventoryapp.contract.mapping.alsAnsicht

import ch.brickinventoryapp.model.domain.Kontoauswahl
import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.data.api.MinifigsApi
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.api.PartsApi
import ch.brickinventoryapp.data.api.asQuery
import ch.brickinventoryapp.data.api.withSetsAsQuery
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.model.domain.FigurAnsicht
import ch.brickinventoryapp.model.domain.ManualMinifigView
import ch.brickinventoryapp.model.domain.ManualPartView
import ch.brickinventoryapp.model.domain.TeilAnsicht
import ch.brickinventoryapp.model.domain.Merksortierung
import ch.brickinventoryapp.model.domain.Setsortierung
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.local.Local
import ch.brickinventoryapp.offline.Fach
import ch.brickinventoryapp.offline.Slots
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
 * Seitengrösse der Galerie, wie in der Webapp (public/js/sammlung.js): Zwei
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
    private val teile: PartsApi,
    private val figuren: MinifigsApi,
    ablage: Offlineablage,
    private val retry: Wiederholung,
) {
    /**
     * Ein Lesemodell, das nur der Server füllt: die zuletzt gefragte Liste im
     * Speicher, nie in Room. Ändert sich die Ablage ([trigger]), fragt es den
     * Server neu — ein Schreibvorgang zeigt sich so auch hier, ohne Signal.
     */
    class Serversicht<A, T>(
        private val ablage: Offlineablage,
        private val trigger: Array<Fach<*>>,
        private val clock: () -> Long = System::currentTimeMillis,
        private val fetch: suspend (A) -> Ergebnis<List<T>>,
    ) {
        private data class Eintrag<A, T>(val bereich: String, val abfrage: A, val liste: Local<T>)

        private val zuletzt = MutableStateFlow<Eintrag<A, T>?>(null)

        /** Nie geladen heisst Stand null, wie in der Ablage; eine Antwort für ein anderes Konto zählt nicht. */
        fun observe(abfrage: A): Flow<Local<T>> = channelFlow {
            launch { ablage.altered(*trigger).collectLatest { refresh(abfrage) } }
            launch {
                zuletzt.map { e ->
                    if (e == null || e.abfrage != abfrage || e.bereich != ablage.bereich()) Local(emptyList(), null) else e.liste
                }.distinctUntilChanged().collect { send(it) }
            }
            awaitClose()
        }

        suspend fun refresh(abfrage: A): Ergebnis<Unit> {
            val vorher = ablage.bereich() ?: return Ergebnis.Erfolg(Unit)
            return when (val r = fetch(abfrage)) {
                is Ergebnis.Erfolg -> {
                    if (ablage.bereich() == vorher) zuletzt.value = Eintrag(vorher, abfrage, Local(r.data, clock()))
                    Ergebnis.Erfolg(Unit)
                }
                is Ergebnis.Fehler -> r
            }
        }
    }

    data class SetsQuery(val konten: Kontoauswahl?, val suche: String?, val thema: String?,
                           val sort: Setsortierung?, val lagerort: String?)
    data class RememberQuery(val konten: Kontoauswahl, val suche: String?, val zustand: Zustand?, val sort: Merksortierung?)
    data class PartsQuery(val konten: Kontoauswahl?, val suche: String?, val farbe: ColorPicker, val kategorie: Kategoriewahl,
                            val spareParts: Ersatzteilwahl, val mitSets: Boolean, val lagerort: String?)
    data class ManualQuery(val konten: Kontoauswahl?, val suche: String?, val lagerort: String?)
    data class MinifigsQuery(val konten: Kontoauswahl, val suche: String?)

    val galerie = Serversicht<SetsQuery, SetAnsicht>(ablage, arrayOf(Slots.SETS)) { a ->
        allPages({ it.sets }, { it.setNumber }, { it.total }, retry) { seite ->
            sicherAufrufen { sets.getSets(a.konten?.anfrage, a.suche, a.thema, a.sort?.kennung, seite, GALLERY_PAGE_SIZE, a.lagerort) }
        }.shown { l -> l.map { it.alsAnsicht() } }
    }

    val merkliste = Serversicht<RememberQuery, WantedItemView>(ablage, arrayOf(Slots.MERKLISTE)) { a ->
        retry.wiederhole {
            sicherAufrufen { sets.getMerkliste(a.suche, a.zustand?.kennung, a.sort?.kennung, a.konten.anfrage) }
        }.shown { r -> r.merkposten.map { it.alsAnsicht() } }
    }

    val teileliste = Serversicht<PartsQuery, TeilAnsicht>(ablage, arrayOf(Slots.TEILE)) { a ->
        allPages({ it.parts }, { "${it.partNumber}|${it.colorId}|${it.isSpare}" }, { it.total }, retry) { seite ->
            sicherAufrufen {
                teile.getParts(search = a.suche, color = a.farbe.wert, category = a.kategorie.wert, page = seite, pageSize = 500, excludeManual = "1", accounts = a.konten?.anfrage,
                    spare = a.spareParts.asQuery(), withSets = withSetsAsQuery(a.mitSets), storage = a.lagerort)
            }
        }.shown { l -> l.map { it.alsAnsicht() } }
    }

    val manuelleTeile = Serversicht<ManualQuery, ManualPartView>(ablage, arrayOf(Slots.MANUELLE_TEILE)) { a ->
        retry.wiederhole { sicherAufrufen { teile.getManualParts(a.konten?.anfrage, a.suche, a.lagerort) } }
            .shown { r -> r.parts.map { it.alsAnsicht() } }
    }

    val figurenliste = Serversicht<MinifigsQuery, FigurAnsicht>(ablage, arrayOf(Slots.FIGUREN)) { a ->
        retry.wiederhole {
            sicherAufrufen { figuren.getMinifigs(source = "set", accounts = a.konten.anfrage, search = a.suche) }
        }.shown { r -> r.figs.map { it.alsAnsicht() } }
    }

    val manualMinifigs = Serversicht<MinifigsQuery, ManualMinifigView>(ablage, arrayOf(Slots.MANUELLE_FIGUREN)) { a ->
        retry.wiederhole { sicherAufrufen { figuren.getManualMinifigs(a.konten.anfrage, a.suche) } }
            .shown { r -> r.figs.map { it.alsAnsicht() } }
    }
}
