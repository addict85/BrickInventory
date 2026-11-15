package ch.brickinventoryapp.zustand.ui

import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.lokal.Abgleichsereignis
import ch.brickinventoryapp.data.lokal.Ausgangslage
import ch.brickinventoryapp.data.lokal.Ausgangslage.VerworfeneAenderung
import ch.brickinventoryapp.data.repository.Bestandsabgleich
import ch.brickinventoryapp.model.lokal.Bestandsart
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
    lage: Ausgangslage,
    abgleich: Bestandsabgleich,
    meldungen: MeldungsKanal,
): Ausgangsmelder = AusgangsBeobachter(lage, abgleich, meldungen)

@Singleton
class AusgangsBeobachter @Inject constructor(
    private val lage: Ausgangslage,
    private val abgleich: Bestandsabgleich,
    private val meldungen: MeldungsKanal,
) : Ausgangsmelder {
    private val _offene = MutableStateFlow(0)
    override val offene: StateFlow<Int> = _offene.asStateFlow()
    private val gestartet = AtomicBoolean(false)

    override fun starte(scope: CoroutineScope) {
        if (!gestartet.compareAndSet(false, true)) return
        scope.launch {
            var vorher = 0
            lage.offene().collect { n ->
                _offene.value = n
                if (n > vorher) meldungen.zeige(Meldung.Menge(R.plurals.offline_ausgang, n))
                vorher = n
            }
        }
        scope.launch { lage.ereignisse.collect { melde(it) } }
        scope.launch { lage.verworfene().collect { l -> l.firstOrNull()?.let { meldeVerworfen(it) } } }
        // Was vom letzten Mal noch wartet, geht beim Start raus.
        scope.launch { lage.planeLiegengebliebenes() }
    }

    private suspend fun melde(e: Abgleichsereignis) {
        when (e) {
            is Abgleichsereignis.Gesendet -> e.arten.mapNotNull { listeFuer(it) }.toSet().forEach { gleicheAb(it) }
        }
    }

    /** Quittiert erst, wenn der Hinweis an der Reihe war und weggeräumt ist; bis dahin hält ihn die Ablage. */
    private suspend fun meldeVerworfen(v: VerworfeneAenderung) {
        val grund = if (v.unlesbar) Meldung.Ressource(R.string.offline_verworfen_unlesbar)
            else v.meldung.ifBlank { null } ?: Meldung.Ressource(R.string.offline_verworfen_ohne_grund)
        val hinweis = Meldung.Ressource(R.string.offline_verworfen, listOf(v.ziel, grund))
        meldungen.zeige(hinweis)
        meldungen.meldung.first { it == hinweis }
        meldungen.meldung.first { it != hinweis }
        lage.quittiere(v)
    }

    /** Teile und manuelle Teile kommen mit einem Abruf; so auch die Figuren. */
    private enum class Liste { SETS, MERKLISTE, TEILE, FIGUREN }

    private fun listeFuer(art: Bestandsart): Liste? = when (art) {
        Bestandsart.SETS -> Liste.SETS
        Bestandsart.MERKLISTE -> Liste.MERKLISTE
        Bestandsart.TEILE, Bestandsart.MANUELLE_TEILE -> Liste.TEILE
        Bestandsart.FIGUREN, Bestandsart.MANUELLE_FIGUREN -> Liste.FIGUREN
        // Ändern sich nie über den Ausgang, nur online.
        Bestandsart.GUTSCHEINE, Bestandsart.PREISALARME, Bestandsart.LAGERORTE,
        Bestandsart.KENNZAHLEN, Bestandsart.KATALOG_META -> null
    }

    private suspend fun gleicheAb(l: Liste) {
        when (l) {
            Liste.SETS -> abgleich.sets()
            Liste.MERKLISTE -> abgleich.merkliste()
            Liste.TEILE -> abgleich.teile()
            Liste.FIGUREN -> abgleich.figuren()
        }
    }
}

/** Das Startbildschirm-Widget neu zeichnen; die App setzt es (AppModule), core-zustand kennt es nicht. */
fun interface Widgetanstoss {
    suspend fun aktualisiere()
}
