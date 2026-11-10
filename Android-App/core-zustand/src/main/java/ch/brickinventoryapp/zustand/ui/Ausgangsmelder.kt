package ch.brickinventoryapp.zustand.ui

import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.lokal.Abgleichsereignis
import ch.brickinventoryapp.data.lokal.Ausgangslage
import ch.brickinventoryapp.model.lokal.Bestandsart
import ch.brickinventoryapp.zustand.ui.viewmodel.Texte
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Macht den Ausgang sichtbar: die Zahl offener Änderungen für die Leiste, ein
 * Hinweis, sobald etwas offline gespeichert wurde oder der Server es ablehnte,
 * und ein Nachladen der betroffenen Listen, wenn gesendet wurde — die lokale
 * Annahme wird so durch den Serverstand ersetzt.
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
    bestand: Bestandssignal,
    meldungen: MeldungsKanal,
    texte: Texte,
): Ausgangsmelder = AusgangsBeobachter(lage, bestand, meldungen, texte)

@Singleton
class AusgangsBeobachter @Inject constructor(
    private val lage: Ausgangslage,
    private val bestand: Bestandssignal,
    private val meldungen: MeldungsKanal,
    private val texte: Texte,
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
                if (n > vorher) meldungen.zeige(texte.menge(R.plurals.offline_ausgang, n, n))
                vorher = n
            }
        }
        scope.launch { lage.ereignisse.collect { melde(it) } }
        // Was vom letzten Mal noch wartet, geht beim Start raus.
        scope.launch { lage.planeLiegengebliebenes() }
    }

    private fun melde(e: Abgleichsereignis) {
        when (e) {
            is Abgleichsereignis.Gesendet -> {
                val signale = e.arten.mapNotNull { signal(it) }.distinct()
                if (signale.isNotEmpty()) bestand.melde(*signale.toTypedArray())
            }
            is Abgleichsereignis.Verworfen -> meldungen.zeige(texte.text(R.string.offline_verworfen,
                e.ziel, e.meldung.ifBlank { texte.text(R.string.offline_verworfen_ohne_grund) }))
        }
    }

    private fun signal(art: Bestandsart): Aenderung? = when (art) {
        Bestandsart.SETS -> Aenderung.Sets
        Bestandsart.MERKLISTE -> Aenderung.Merkliste
        Bestandsart.TEILE, Bestandsart.MANUELLE_TEILE -> Aenderung.Teile
        Bestandsart.FIGUREN, Bestandsart.MANUELLE_FIGUREN -> Aenderung.Figuren
        Bestandsart.GUTSCHEINE -> null
    }
}

/** Das Startbildschirm-Widget neu zeichnen; die App setzt es (AppModule), core-zustand kennt es nicht. */
fun interface Widgetanstoss {
    suspend fun aktualisiere()
}
