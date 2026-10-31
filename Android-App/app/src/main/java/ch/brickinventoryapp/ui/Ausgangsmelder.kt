package ch.brickinventoryapp.ui

import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.lokal.Abgleichsereignis
import ch.brickinventoryapp.data.lokal.Bestandsart
import ch.brickinventoryapp.data.lokal.Offlineablage
import ch.brickinventoryapp.ui.viewmodel.Texte
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Macht den Ausgang sichtbar: die Zahl offener Änderungen für die Leiste, ein
 * Hinweis, sobald etwas offline gespeichert wurde oder der Server es ablehnte,
 * und ein Nachladen der betroffenen Listen, wenn gesendet wurde — die lokale
 * Annahme wird so durch den Serverstand ersetzt.
 */
class Ausgangsmelder @Inject constructor(
    private val ablage: Offlineablage,
    private val bestand: Bestandssignal,
    private val meldungen: MeldungsKanal,
    private val texte: Texte,
) {
    /** Einmal je Prozess starten (AppViewModel); liefert die Zahl offener Änderungen. */
    fun starte(scope: CoroutineScope): StateFlow<Int> {
        val offene = ablage.offene().stateIn(scope, SharingStarted.Eagerly, 0)
        scope.launch {
            var vorher = 0
            offene.collect { n ->
                if (n > vorher) meldungen.fluss.value = texte.menge(R.plurals.offline_ausgang, n, n)
                vorher = n
            }
        }
        scope.launch { ablage.ereignisse.collect { melde(it) } }
        // Was vom letzten Mal noch wartet, geht beim Start raus.
        scope.launch { if (ablage.wartet()) ablage.planeSenden() }
        return offene
    }

    private fun melde(e: Abgleichsereignis) {
        when (e) {
            is Abgleichsereignis.Gesendet -> {
                val signale = e.arten.mapNotNull { signal(it) }.distinct()
                if (signale.isNotEmpty()) bestand.melde(*signale.toTypedArray())
            }
            is Abgleichsereignis.Verworfen -> meldungen.fluss.value = texte.text(R.string.offline_verworfen,
                e.bearbeitung.ziel, e.meldung.ifBlank { texte.text(R.string.offline_verworfen_ohne_grund) })
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
