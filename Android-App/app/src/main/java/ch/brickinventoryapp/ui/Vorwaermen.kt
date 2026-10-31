package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.ScopeFilter
import ch.brickinventoryapp.data.repository.BrickRepository
import ch.brickinventoryapp.data.repository.GALLERY_PAGE_SIZE
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.util.resolveThumbUrl

/**
 * Die Adressen aller Kacheln der eigenen Sammlung, zum Vorwärmen.
 *
 * Gesammelt wird hier und nicht in VorschauVorwaermer, weil nur hier der
 * Kontofilter bekannt ist: Vorgewärmt werden soll die Sammlung, die man zu
 * sehen bekommt. Der Katalog bleibt draussen — rund 25'000 Sets sprengten die
 * Ablage und verdrängten ausgerechnet die eigene Sammlung.
 *
 * Nicht `load…` benannt: Die Funktion füllt keinen Zustand, sie sammelt nur.
 */
internal suspend fun bildAdressenDerSammlung(repo: BrickRepository, blickfeld: Blickfeld, basis: String): List<String> {
    val roh = mutableListOf<String?>()

    // Galerie: Kontofilter ja, Suche/Thema/Sortierung ausdrücklich nicht. Die
    // Seitengrösse der Galerie, weil getSets() die erste Seite unter „sets"
    // zwischenspeichert — eine andere Grösse überschriebe den Eintrag der Galerie.
    var seite = 1
    while (seite <= MAX_SEITEN) {
        val a = repo.sets.getSets(blickfeld.kontoFuer(ScopeFilter.View.GALLERY),
            search = null, theme = null, sort = null, page = seite, pageSize = GALLERY_PAGE_SIZE)
        val liste = if (a is Result.Success) a.data.sets else emptyList()
        liste.mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }
        if (liste.size < GALLERY_PAGE_SIZE) break
        seite++
    }

    seite = 1
    while (seite <= MAX_SEITEN) {
        val a = repo.teile.getParts(search = null, page = seite,
            accounts = blickfeld.kontoFuer(ScopeFilter.View.PARTS))
        val liste = if (a is Result.Success) a.data.parts else emptyList()
        liste.mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }
        if (liste.size < TEILE_SEITE) break
        seite++
    }

    val figuren = repo.figuren.getMinifigs(blickfeld.kontoFuer(ScopeFilter.View.MINIFIGS))
    if (figuren is Result.Success) {
        figuren.data.figs.mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }
    }
    val mTeile = repo.teile.getManualParts(blickfeld.kontoFuer(ScopeFilter.View.PARTS))
    if (mTeile is Result.Success) {
        mTeile.data.parts.mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }
    }
    val mFiguren = repo.figuren.getManualMinifigs(blickfeld.kontoFuer(ScopeFilter.View.MINIFIGS))
    if (mFiguren is Result.Success) {
        mFiguren.data.figs.mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }
    }
    return roh.filterNotNull()
}

/** Die feste Seitengrösse von TeileRepository.getParts: eine kürzere Antwort ist die letzte Seite. */
private const val TEILE_SEITE = 500

/** Notbremse gegen eine Sammlung, die es so nicht geben sollte. */
private const val MAX_SEITEN = 50
