package ch.brickinventoryapp.state.ui

import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.local.Abgleichsereignis
import ch.brickinventoryapp.data.local.Baseline
import ch.brickinventoryapp.data.local.Baseline.DiscardedChange
import ch.brickinventoryapp.data.repository.Bestandsabgleich
import ch.brickinventoryapp.model.local.StockKind
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
 * Makes the outbox visible: the number of open changes for the bar, a
 * hint as soon as something was stored offline or the server rejected it,
 * and the server state of the affected lists into the store once something was sent —
 * the local assumption is thereby replaced.
 */
interface Ausgangsmelder {
    /** The number of open changes; 0 until [starte] has run. */
    val offene: StateFlow<Int>

    /** Once per process (the Application); a second call does nothing. */
    fun starte(scope: CoroutineScope)
}

/** For tests without Hilt. */
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
        // Whatever is still waiting from last time goes out at startup.
        scope.launch { situation.planeLeftover() }
    }

    private suspend fun melde(e: Abgleichsereignis) {
        when (e) {
            is Abgleichsereignis.Sent -> e.kinds.mapNotNull { listFor(it) }.toSet().forEach { sameAb(it) }
        }
    }

    /** Only acknowledges once the hint has had its turn and been cleared away; until then the store holds it. */
    private suspend fun reportDiscarded(v: DiscardedChange) {
        val grund = if (v.unlesbar) Meldung.Resource(R.string.offline_verworfen_unlesbar)
            else v.meldung.ifBlank { null } ?: Meldung.Resource(R.string.offline_verworfen_ohne_grund)
        val hinweis = Meldung.Resource(R.string.offline_verworfen, listOf(v.ziel, grund))
        meldungen.zeige(hinweis)
        meldungen.meldung.first { it == hinweis }
        meldungen.meldung.first { it != hinweis }
        situation.acknowledge(v)
    }

    /** Parts and manual parts come with one fetch; so do the figures. */
    private enum class Liste { SETS, MERKLISTE, TEILE, FIGUREN }

    private fun listFor(art: StockKind): Liste? = when (art) {
        StockKind.SETS -> Liste.SETS
        StockKind.MERKLISTE -> Liste.MERKLISTE
        StockKind.TEILE, StockKind.MANUELLE_TEILE -> Liste.TEILE
        StockKind.FIGUREN, StockKind.MANUELLE_FIGUREN -> Liste.FIGUREN
        // Never change via the outbox, only online.
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

/** Redraw the home-screen widget; the app sets it (AppModule), core-state doesn't know it. */
fun interface Widgetanstoss {
    suspend fun refresh()
}
