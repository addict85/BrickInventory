package ch.brickinventoryapp.state.ui

import ch.brickinventoryapp.model.domain.ColorPicker
import ch.brickinventoryapp.model.domain.Kategoriewahl
import ch.brickinventoryapp.session.WarmUp
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.data.repository.MinifigsRepository
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.PartsRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.Kontosicht
import ch.brickinventoryapp.data.repository.Kontosicht.Serversicht
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.model.local.Local
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import ch.brickinventoryapp.data.Credentials
import ch.brickinventoryapp.data.cache.VorschauVorwaermer
import ch.brickinventoryapp.model.coroutines.ApplicationScope
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import ch.brickinventoryapp.model.util.resolveThumbUrl
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The addresses of all tiles in the own collection, for warming up — from the same
 * sources as the tabs: the store, with the account filter the account view.
 * Here and not in the warmer, because only here is the account filter known; the catalog stays
 * out, it would crowd out the own collection.
 */
internal suspend fun imageAddressesTheCollection(
    sets: SetsRepository, teile: PartsRepository, figuren: MinifigsRepository, kontosicht: Kontosicht,
    blickfeld: Scope, basis: String,
): List<String> {
    val roh = mutableListOf<String?>()
    val galerie = blickfeld.accountFor(ScopeFilter.View.GALLERY)?.let { Kontosicht.SetsQuery(it, null, null, null, null) }
    liste(galerie, kontosicht.galerie, sets::aktualisiereSets, sets.observeSets())
        .mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }

    val partsAccount = blickfeld.accountFor(ScopeFilter.View.PARTS)
    val partsQuery = partsAccount?.let { Kontosicht.PartsQuery(it, null, ColorPicker.Alle, Kategoriewahl.Alle, Ersatzteilwahl.ALLE, false, null) }
    liste(partsQuery, kontosicht.teileliste, teile::refreshParts, teile.observeParts())
        .mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }

    val minifigsQuery = blickfeld.accountFor(ScopeFilter.View.MINIFIGS)?.let { Kontosicht.MinifigsQuery(it, null) }
    liste(minifigsQuery, kontosicht.figurenliste, figuren::refreshMinifigs, figuren.observeMinifigs())
        .mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }
    // refreshParts resp. refreshMinifigs has already fetched the manual lists along.
    liste(partsAccount?.let { Kontosicht.ManualQuery(it, null, null) }, kontosicht.manuelleTeile,
        { Ergebnis.Erfolg(Unit) }, teile.observeManualParts())
        .mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }
    liste(minifigsQuery, kontosicht.manualMinifigs, { Ergebnis.Erfolg(Unit) }, figuren.observeManualMinifigs())
        .mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }
    return roh.filterNotNull()
}

private suspend fun <A, T> liste(abfrage: A?, view: Serversicht<A, T>, refresh: suspend () -> Ergebnis<Unit>,
                                 ablage: Flow<Local<T>>): List<T> {
    if (abfrage == null) {
        refresh()
        return ablage.first().liste
    }
    view.refresh(abfrage)
    return view.observe(abfrage).first().liste
}

/**
 * Warms up the collection's preview images once per app start. In the app's
 * scope, not the screen's: a rotation should neither abort the round nor start a
 * second one through the same images.
 */
@Singleton
class CollectionWarmUp @Inject constructor(
    private val vorwaermer: VorschauVorwaermer,
    private val sets: SetsRepository,
    private val teile: PartsRepository,
    private val figuren: MinifigsRepository,
    private val kontosicht: Kontosicht,
    private val blickfeld: Scope,
    private val prefs: Credentials,
    @param:ApplicationScope private val bereich: CoroutineScope,
) : WarmUp {
    private val gestartet = AtomicBoolean(false)

    override fun kick() {
        if (!gestartet.compareAndSet(false, true)) return
        bereich.launch {
            delay(VorschauVorwaermer.ANLAUF_MS)
            // Check network state and space first, otherwise every start costs four list fetches for nothing.
            if (!vorwaermer.darfStarten()) return@launch
            val basis = fangeAusserAbbruch { prefs.serverUrlJetzt() }.getOrNull().orEmpty()
            if (basis.isBlank()) return@launch
            vorwaermer.vorwaermen(imageAddressesTheCollection(sets, teile, figuren, kontosicht, blickfeld, basis))
        }
    }
}
