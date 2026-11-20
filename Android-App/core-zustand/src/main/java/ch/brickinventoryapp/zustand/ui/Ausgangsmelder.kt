package ch.brickinventoryapp.zustand.ui

import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.lokal.Abgleichsereignis
import ch.brickinventoryapp.data.lokal.Baseline
import ch.brickinventoryapp.data.lokal.Baseline.DiscardedChange
import ch.brickinventoryapp.data.repository.Bestandsabgleich
import ch.brickinventoryapp.model.lokal.StockKind
import ch.brickinventoryapp.model.ui.Meldung
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Macht den Ausgang sichtbar: die Zahl offener Änderungen für die Leiste, ein
 * Hinweis, sobald etwas offline gespeichert wurde oder der Server es ablehnte,
 * und der Serverstand der betroffenen Listen in die Ablage, wenn gesendet wurde —
 * die lokale Annahme wird so ersetzt.
 */
interface Ausgangsmelder {
    /** Die Zahl offener Änderungen; 0, bis [starte] lief. */
    val offene: StateFlow<Int>

    /** Einmal je Prozess (die Application); ein zweiter Aufruf tut nichts. */
    fun starte(scope: CoroutineScope)
}

/** Für Tests ohne Hilt. */
fun Ausgangsmelder(
    situation: Baseline,
    sync: Bestandsabgleich,
    meldungen: MeldungsKanal,
): Ausgangsmelder = InitialObserver(situation, sync, meldungen)

@Singleton
class InitialObserver @Inject constructor(
    private val situation: Baseline,
    private val sync: Bestandsabgleich,
    private val meldungen: MeldungsKanal,
) : Ausgangsmelder {
    private val _open = MutableStateFlow(0)
    override val offene: StateFlow<Int> = _open.asStateFlow()
    private val gestartet = AtomicBoolean(false)

    override fun starte(scope: CoroutineScope) {
        if (!gestartet.compareAndSet(false, true)) return
        scope.launch {
            var vorher = 0
            situation.offene().collect { n ->
                _open.value = n
                if (n > vorher) meldungen.zeige(Meldung.Menge(R.plurals.offline_ausgang, n))
                vorher = n
            }
        }
        scope.launch { situation.events.collect { melde(it) } }
        scope.launch { situation.discarded().collect { l -> l.firstOrNull()?.let { reportDiscarded(it) } } }
        // Was vom letzten Mal noch wartet, geht beim Start raus.
        scope.launch { situation.planeLeftover() }
    }

    private suspend fun melde(e: Abgleichsereignis) {
        when (e) {
            is Abgleichsereignis.Sent -> e.kinds.mapNotNull { listFor(it) }.toSet().forEach { sameAb(it) }
        }
    }

    /** Quittiert erst, wenn der Hinweis an der Reihe war und weggeräumt ist; bis dahin hält ihn die Ablage. */
    private suspend fun reportDiscarded(v: DiscardedChange) {
        val grund = if (v.unlesbar) Meldung.Resource(R.string.offline_verworfen_unlesbar)
            else v.meldung.ifBlank { null } ?: Meldung.Resource(R.string.offline_verworfen_ohne_grund)
        val hinweis = Meldung.Resource(R.string.offline_verworfen, listOf(v.ziel, grund))
        meldungen.zeige(hinweis)
        meldungen.meldung.first { it == hinweis }
        meldungen.meldung.first { it != hinweis }
        situation.acknowledge(v)
    }

    /** Teile und manuelle Teile kommen mit einem Abruf; so auch die Figuren. */
    private enum class Liste { SETS, MERKLISTE, TEILE, FIGUREN }

    private fun listFor(art: StockKind): Liste? = when (art) {
        StockKind.SETS -> Liste.SETS
        StockKind.MERKLISTE -> Liste.MERKLISTE
        StockKind.TEILE, StockKind.MANUELLE_TEILE -> Liste.TEILE
        StockKind.FIGUREN, StockKind.MANUELLE_FIGUREN -> Liste.FIGUREN
        // Ändern sich nie über den Ausgang, nur online.
        StockKind.GUTSCHEINE, StockKind.PREISALARME, StockKind.LAGERORTE,
        StockKind.KENNZAHLEN, StockKind.KATALOG_META -> null
    }

    private suspend fun sameAb(l: Liste) {
        when (l) {
            Liste.SETS -> sync.sets()
            Liste.MERKLISTE -> sync.merkliste()
            Liste.TEILE -> sync.teile()
            Liste.FIGUREN -> sync.figuren()
        }
    }
}

/** Das Startbildschirm-Widget neu zeichnen; die App setzt es (AppModule), core-zustand kennt es nicht. */
fun interface Widgetanstoss {
    suspend fun refresh()
}
