package ch.brickinventoryapp.state.ui

import ch.brickinventoryapp.model.domain.ColorPicker
import ch.brickinventoryapp.model.domain.CategoryChoice
import ch.brickinventoryapp.session.WarmUp
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.data.repository.MinifigsRepository
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.PartsRepository
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.repository.AccountView
import ch.brickinventoryapp.data.repository.AccountView.ServerView
import ch.brickinventoryapp.model.data.SparePartChoice
import ch.brickinventoryapp.model.local.Local
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import ch.brickinventoryapp.data.Credentials
import ch.brickinventoryapp.data.cache.PreviewPrewarmer
import ch.brickinventoryapp.model.coroutines.ApplicationScope
import ch.brickinventoryapp.model.util.catchUnlessCancelled
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
    sets: SetsRepository, parts: PartsRepository, figures: MinifigsRepository, accountView: AccountView,
    viewport: Scope, basis: String,
): List<String> {
    val raw = mutableListOf<String?>()
    val gallery = viewport.accountFor(ScopeFilter.View.GALLERY)?.let { AccountView.SetsQuery(it, null, null, null, null) }
    list(gallery, accountView.gallery, sets::refreshSets, sets.observeSets())
        .mapTo(raw) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }

    val partsAccount = viewport.accountFor(ScopeFilter.View.PARTS)
    val partsQuery = partsAccount?.let { AccountView.PartsQuery(it, null, ColorPicker.All, CategoryChoice.All, SparePartChoice.ALL, false, null) }
    list(partsQuery, accountView.partList, parts::refreshParts, parts.observeParts())
        .mapTo(raw) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }

    val minifigsQuery = viewport.accountFor(ScopeFilter.View.MINIFIGS)?.let { AccountView.MinifigsQuery(it, null) }
    list(minifigsQuery, accountView.figureList, figures::refreshMinifigs, figures.observeMinifigs())
        .mapTo(raw) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }
    // refreshParts resp. refreshMinifigs has already fetched the manual lists along.
    list(partsAccount?.let { AccountView.ManualQuery(it, null, null) }, accountView.manualParts,
        { Outcome.Success(Unit) }, parts.observeManualParts())
        .mapTo(raw) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }
    list(minifigsQuery, accountView.manualMinifigs, { Outcome.Success(Unit) }, figures.observeManualMinifigs())
        .mapTo(raw) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }
    return raw.filterNotNull()
}

private suspend fun <A, T> list(query: A?, view: ServerView<A, T>, refresh: suspend () -> Outcome<Unit>,
                                 store: Flow<Local<T>>): List<T> {
    if (query == null) {
        refresh()
        return store.first().list
    }
    view.refresh(query)
    return view.observe(query).first().list
}

/**
 * Warms up the collection's preview images once per app start. In the app's
 * scope, not the screen's: a rotation should neither abort the round nor start a
 * second one through the same images.
 */
@Singleton
class CollectionWarmUp @Inject constructor(
    private val prewarmer: PreviewPrewarmer,
    private val sets: SetsRepository,
    private val parts: PartsRepository,
    private val figures: MinifigsRepository,
    private val accountView: AccountView,
    private val viewport: Scope,
    private val prefs: Credentials,
    @param:ApplicationScope private val area: CoroutineScope,
) : WarmUp {
    private val started = AtomicBoolean(false)

    override fun kick() {
        if (!started.compareAndSet(false, true)) return
        area.launch {
            delay(PreviewPrewarmer.RAMP_UP_MS)
            // Check network state and space first, otherwise every start costs four list fetches for nothing.
            if (!prewarmer.mayStart()) return@launch
            val basis = catchUnlessCancelled { prefs.serverUrlNow() }.getOrNull().orEmpty()
            if (basis.isBlank()) return@launch
            prewarmer.prewarm(imageAddressesTheCollection(sets, parts, figures, accountView, viewport, basis))
        }
    }
}
