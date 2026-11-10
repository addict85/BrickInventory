package ch.brickinventoryapp.zustand.ui

import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.data.repository.FigurenRepository
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.data.repository.GALLERY_PAGE_SIZE
import ch.brickinventoryapp.data.repository.Ergebnis
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
 * Die Adressen aller Kacheln der eigenen Sammlung, zum Vorwärmen.
 * Hier und nicht im Vorwärmer, weil nur hier der Kontofilter bekannt ist; der Katalog bleibt
 * draussen, er verdrängte die eigene Sammlung.
 */
internal suspend fun bildAdressenDerSammlung(
    sets: SetsRepository, teile: TeileRepository, figuren: FigurenRepository, blickfeld: Blickfeld, basis: String,
): List<String> {
    val roh = mutableListOf<String?>()

    // Galerie: Kontofilter ja, Suche/Thema/Sortierung ausdrücklich nicht. Die
    // Seitengrösse der Galerie, weil getSets() die erste Seite unter „sets"
    // zwischenspeichert — eine andere Grösse überschriebe den Eintrag der Galerie.
    var seite = 1
    while (seite <= MAX_SEITEN) {
        val a = sets.getSets(blickfeld.kontoFuer(ScopeFilter.View.GALLERY),
            search = null, theme = null, sort = null, page = seite, pageSize = GALLERY_PAGE_SIZE)
        val liste = if (a is Ergebnis.Success) a.data.sets else emptyList()
        liste.mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }
        if (liste.size < GALLERY_PAGE_SIZE) break
        seite++
    }

    seite = 1
    while (seite <= MAX_SEITEN) {
        val a = teile.getParts(search = null, page = seite,
            accounts = blickfeld.kontoFuer(ScopeFilter.View.PARTS))
        val liste = if (a is Ergebnis.Success) a.data.parts else emptyList()
        liste.mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }
        if (liste.size < TEILE_SEITE) break
        seite++
    }

    val figurenAntwort = figuren.getMinifigs(blickfeld.kontoFuer(ScopeFilter.View.MINIFIGS))
    if (figurenAntwort is Ergebnis.Success) {
        figurenAntwort.data.figs.mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }
    }
    val mTeile = teile.getManualParts(blickfeld.kontoFuer(ScopeFilter.View.PARTS))
    if (mTeile is Ergebnis.Success) {
        mTeile.data.parts.mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }
    }
    val mFiguren = figuren.getManualMinifigs(blickfeld.kontoFuer(ScopeFilter.View.MINIFIGS))
    if (mFiguren is Ergebnis.Success) {
        mFiguren.data.figs.mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }
    }
    return roh.filterNotNull()
}

/** Die feste Seitengrösse von TeileRepository.getParts: eine kürzere Antwort ist die letzte Seite. */
private const val TEILE_SEITE = 500

/** Notbremse gegen eine Sammlung, die es so nicht geben sollte. */
private const val MAX_SEITEN = 50

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
            vorwaermer.vorwaermen(bildAdressenDerSammlung(sets, teile, figuren, blickfeld, basis))
        }
    }
}
