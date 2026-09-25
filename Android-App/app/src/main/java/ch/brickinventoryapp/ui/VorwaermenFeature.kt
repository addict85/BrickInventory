package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.ScopeFilter
import ch.brickinventoryapp.data.cache.VorschauVorwaermer
import ch.brickinventoryapp.data.repository.GALLERY_PAGE_SIZE
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.util.resolveThumbUrl
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * Vorwaermen: die Bilder der Sammlung holen, bevor jemand sie aufruft.
 *
 * ── Marcos Anforderung ──────────────────────────────────────────────────────
 * „Ergaenzen dass die Android-App bereits im Hintergrund Bilder cached auch
 * wenn diese noch nicht aufgerufen wurden aus allen Reiter. Dabei soll nicht
 * mehr als 80% des Speichercaches genutzt werden."
 *
 * ── Warum das hier oben steht und nicht in der Datenschicht ─────────────────
 *
 * Die erste Fassung fragte die Reiter unten in VorschauVorwaermer selbst ab
 * und liess dabei den Kontofilter des Haushalts weg. GalerieLaedtGefiltertTest
 * und ListenfilterImZustandTest haben das gemeldet, und zwar zu Recht: Beide
 * Regeln sind gegen genau diese Form gebaut — ein ZWEITER Ladeweg, der den
 * Filter nicht kennt. Der Schaden dort war eine ungefilterte Liste neben einer
 * gefilterten Gesamtzahl; hier waere er eine vorgewaermte Sammlung, die nicht
 * die ist, die man zu sehen bekommt.
 *
 * `scopeFor()` lebt im Zustand des MainViewModel. Also gehoert das Sammeln
 * hierher, zu den uebrigen Feature-Modulen, und die Datenschicht bekommt eine
 * fertige Liste. Sie behaelt, was wirklich ihre Sache ist: holen, drosseln und
 * die Grenze einhalten.
 *
 * ── Welche Reiter, und warum der Katalog NICHT ──────────────────────────────
 *
 * Vorgewaermt wird die EIGENE Sammlung ueber alle Reiter, die Kacheln zeigen:
 * Galerie, Teile, Minifiguren und die manuell erfassten Teile und Figuren —
 * letztere erscheinen auch im Finanzen-Reiter, es sind dieselben Bilder.
 *
 * Der Katalog bleibt draussen, und das ist eine Entscheidung und kein
 * Versehen: Er ist nicht die Sammlung, sondern das Verzeichnis ALLER Sets, die
 * es gibt — rund 25'000. Bei etwa 15 kB je Vorschau waeren das ueber 350 MB,
 * also mehr als das Doppelte der ganzen Ablage und ein Vielfaches der Grenze.
 * Das Vorwaermen wuerde mittendrin abbrechen, haette dabei das
 * Mobilfunkvolumen aufgebraucht und ausgerechnet die eigene Sammlung
 * verdraengt. Der Katalog bedient sich weiterhin beim Blaettern, wie bisher.
 */

/**
 * Die Vorwaermung anstossen — einmal je App-Start.
 *
 * Auf dem IO-Dispatcher, weil der Bildabruf blockierend gefuehrt wird: Das
 * gehoert nicht auf einen Dispatcher, der auch die Oberflaeche bedient.
 */
internal fun MainViewModel.vorwaermenAnstossen() {
    if (vorwaermenLaeuft) return
    vorwaermenLaeuft = true
    viewModelScope.launch(Dispatchers.IO) {
        delay(VorschauVorwaermer.ANLAUF_MS)
        // Vor dem Sammeln fragen — Netzlage UND Platz. Sonst kostet jeder
        // App-Start vier Listenabrufe, um danach nichts zu tun.
        if (!vorwaermer.darfStarten()) return@launch
        // Aus den Einstellungen, NICHT aus `_state.value.serverUrl`:
        // StateDomainBoundaryTest hat die zweite Form gemeldet, und zu Recht —
        // das Feld gehoert der Sitzung, und eine Ausnahme dafuer waere die
        // dritte in dieser Liste gewesen. `prefs.serverUrl` ist ohnehin die
        // Quelle; das Zustandsfeld ist nur ihr Spiegel, gesetzt im selben
        // combine-Zweig, der diese Vorwaermung anstoesst.
        val basis = runCatching { prefs.serverUrlJetzt() }.getOrNull().orEmpty()
        if (basis.isBlank()) return@launch
        vorwaermer.vorwaermen(bildAdressenDerSammlung(basis))
    }
}

/**
 * Die Adressen aller Kacheln der eigenen Sammlung.
 *
 * Nicht `load…` benannt, und das ist kein Zufall: Diese Funktion fuellt keinen
 * Zustand und blaettert keine Liste, sie sammelt nur Adressen. Die Lader
 * heissen in diesem Baum `load…`, und ListenfilterImZustandTest prueft genau
 * die — eine Funktion, die sich so nennt, ohne eine zu sein, waere eine
 * falsche Auskunft an die naechste Regel.
 */
private suspend fun MainViewModel.bildAdressenDerSammlung(basis: String): List<String> {
    val roh = mutableListOf<String?>()

    // ── Galerie ─────────────────────────────────────────────────────────────
    // Der Kontofilter wird MITGEFUEHRT, Suche/Thema/Sortierung ausdruecklich
    // NICHT: Vorgewaermt wird die ganze Sammlung im Blickfeld, nicht das, was
    // gerade zufaellig im Suchfeld steht. Die drei stehen trotzdem im Aufruf,
    // damit man diese Entscheidung sieht, statt sie aus einer Auslassung
    // erraten zu muessen — und GalerieLaedtGefiltertTest verlangt genau das.
    //
    // pageSize = GALLERY_PAGE_SIZE und keine eigene Zahl: getSets() legt die
    // ungefilterte erste Seite unter „sets" im ResponseCache ab, und die
    // Bedingung dafuer prueft die Seitengroesse NICHT. Mit einer eigenen Zahl
    // haette das Vorwaermen der Galerie ihren eigenen Cache-Eintrag unter dem
    // Ruecken weggeschrieben, gefuellt mit einer anders grossen Seite.
    var seite = 1
    while (seite <= MAX_SEITEN) {
        val a = repo.sets.getSets(scopeFor(ScopeFilter.View.GALLERY),
            search = null, theme = null, sort = null, page = seite, pageSize = GALLERY_PAGE_SIZE)
        val liste = if (a is Result.Success) a.data.sets else emptyList()
        liste.mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }
        if (liste.size < GALLERY_PAGE_SIZE) break
        seite++
    }

    // ── Teile ───────────────────────────────────────────────────────────────
    seite = 1
    while (seite <= MAX_SEITEN) {
        val a = repo.teile.getParts(search = null, page = seite,
            accounts = scopeFor(ScopeFilter.View.PARTS))
        val liste = if (a is Result.Success) a.data.parts else emptyList()
        liste.mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }
        // getParts() fragt fest mit pageSize = 500 — eine kuerzere Antwort ist
        // damit die letzte Seite.
        if (liste.size < TEILE_SEITE) break
        seite++
    }

    // ── Minifiguren und die manuell erfassten Stuecke ───────────────────────
    val figuren = repo.teile.getMinifigs(scopeFor(ScopeFilter.View.MINIFIGS))
    if (figuren is Result.Success) {
        figuren.data.figs.mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }
    }
    val mTeile = repo.teile.getManualParts(scopeFor(ScopeFilter.View.PARTS))
    if (mTeile is Result.Success) {
        mTeile.data.parts.mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }
    }
    val mFiguren = repo.teile.getManualMinifigs(scopeFor(ScopeFilter.View.MINIFIGS))
    if (mFiguren is Result.Success) {
        mFiguren.data.figs.mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }
    }

    return roh.filterNotNull()
}

/**
 * Die Seitengroesse, mit der TeileRepository.getParts FEST abfragt — sie
 * laesst sich von aussen nicht setzen. Steht hier, damit „kuerzere Antwort =
 * letzte Seite" nicht an einer nackten Zahl haengt, die niemand mit ihrer
 * Quelle verbindet.
 */
private const val TEILE_SEITE = 500

/** Notbremse gegen eine Sammlung, die es so nicht geben sollte. */
private const val MAX_SEITEN = 50
