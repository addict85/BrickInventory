package ch.brickinventoryapp.zustand.ui

import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.data.repository.FigurenRepository
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.Kontosicht
import ch.brickinventoryapp.data.repository.Kontosicht.Serversicht
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.model.lokal.Lokal
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import ch.brickinventoryapp.data.Zugangsdaten
import ch.brickinventoryapp.data.cache.VorschauVorwaermer
import ch.brickinventoryapp.model.koroutinen.ApplicationScope
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import ch.brickinventoryapp.model.util.resolveThumbUrl
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Die Adressen aller Kacheln der eigenen Sammlung, zum Vorwärmen — aus denselben
 * Quellen wie die Reiter: die Ablage, mit Kontofilter die Kontosicht.
 * Hier und nicht im Vorwärmer, weil nur hier der Kontofilter bekannt ist; der Katalog bleibt
 * draussen, er verdrängte die eigene Sammlung.
 */
internal suspend fun bildAdressenDerSammlung(
    sets: SetsRepository, teile: TeileRepository, figuren: FigurenRepository, kontosicht: Kontosicht,
    blickfeld: Blickfeld, basis: String,
): List<String> {
    val roh = mutableListOf<String?>()
    val galerie = blickfeld.kontoFuer(ScopeFilter.View.GALLERY)?.let { Kontosicht.SetsAbfrage(it, null, null, null, null) }
    liste(galerie, kontosicht.galerie, sets::aktualisiereSets, sets.beobachteSets())
        .mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }

    val teileKonto = blickfeld.kontoFuer(ScopeFilter.View.PARTS)
    val teileAbfrage = teileKonto?.let { Kontosicht.TeileAbfrage(it, null, null, null, Ersatzteilwahl.ALLE, false, null) }
    liste(teileAbfrage, kontosicht.teileliste, teile::aktualisiereTeile, teile.beobachteTeile())
        .mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }

    val figurenAbfrage = blickfeld.kontoFuer(ScopeFilter.View.MINIFIGS)?.let { Kontosicht.FigurenAbfrage(it, null) }
    liste(figurenAbfrage, kontosicht.figurenliste, figuren::aktualisiereFiguren, figuren.beobachteFiguren())
        .mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }
    // Die manuellen Listen hat aktualisiereTeile bzw. aktualisiereFiguren schon mitgeholt.
    liste(teileKonto?.let { Kontosicht.ManuelleAbfrage(it, null, null) }, kontosicht.manuelleTeile,
        { Ergebnis.Success(Unit) }, teile.beobachteManuelleTeile())
        .mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }
    liste(figurenAbfrage, kontosicht.manuelleFiguren, { Ergebnis.Success(Unit) }, figuren.beobachteManuelleFiguren())
        .mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }
    return roh.filterNotNull()
}

private suspend fun <A, T> liste(abfrage: A?, sicht: Serversicht<A, T>, aktualisiere: suspend () -> Ergebnis<Unit>,
                                 ablage: Flow<Lokal<T>>): List<T> {
    if (abfrage == null) {
        aktualisiere()
        return ablage.first().liste
    }
    sicht.aktualisiere(abfrage)
    return sicht.beobachte(abfrage).first().liste
}

/**
 * Wärmt die Vorschaubilder der Sammlung einmal je App-Start vor. Im Bereich der
 * App, nicht des Bildschirms: Ein Drehen soll die Runde weder abbrechen noch eine
 * zweite durch dieselben Bilder starten.
 */
@Singleton
class SammlungVorwaermen @Inject constructor(
    private val vorwaermer: VorschauVorwaermer,
    private val sets: SetsRepository,
    private val teile: TeileRepository,
    private val figuren: FigurenRepository,
    private val kontosicht: Kontosicht,
    private val blickfeld: Blickfeld,
    private val prefs: Zugangsdaten,
    @param:ApplicationScope private val bereich: CoroutineScope,
) : Vorwaermung {
    private val gestartet = AtomicBoolean(false)

    override fun anstossen() {
        if (!gestartet.compareAndSet(false, true)) return
        bereich.launch {
            delay(VorschauVorwaermer.ANLAUF_MS)
            // Erst Netzlage und Platz prüfen, sonst kostet jeder Start vier Listenabrufe umsonst.
            if (!vorwaermer.darfStarten()) return@launch
            val basis = fangeAusserAbbruch { prefs.serverUrlJetzt() }.getOrNull().orEmpty()
            if (basis.isBlank()) return@launch
            vorwaermer.vorwaermen(bildAdressenDerSammlung(sets, teile, figuren, kontosicht, blickfeld, basis))
        }
    }
}
