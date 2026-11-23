package ch.brickinventoryapp.data.cache

import ch.brickinventoryapp.data.DevicesSettings
import ch.brickinventoryapp.data.NetworkState
import ch.brickinventoryapp.data.PrewarmNetwork
import ch.brickinventoryapp.data.di.ImageClient
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import okhttp3.OkHttpClient
import okhttp3.Request
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Mark on a request that only warms. An OkHttp tag instead of a header,
 * because it is none of the server's business. The tap in NetworkModule then stores it
 * as speculative or used.
 */
object WarmUp

/**
 * Fetch images in the background before anyone calls them up, from all tabs and up to
 * 80 % of the store: otherwise offline only what had once been on the screen was available.
 * Which images is decided by ui/Prewarm.kt, because the selection depends on the account
 * filter; what remains here is fetching, throttling and the limit. Without Coil: needed are
 * bytes on disk, not bitmaps in the memory cache.
 */
@Singleton
class PreviewPrewarmer @Inject constructor(
    private val preview: PreviewMemory,
    private val network: NetworkState,
    private val prefs: DevicesSettings,
    @param:ImageClient private val imageClient: OkHttpClient,
) {
    companion object {
        /**
         * Two at a time: the image client has six per host, four stay for what is
         * visible — warming should not slow down the app.
         */
        private const val CONCURRENT = 2

        /** Leave a brief breather after every batch — the same consideration as above. */
        private const val PAUSE_MS = 250L

        /**
         * Start only after this time: at start sign-in and the first
         * wall of tiles compete for the line, warming is in no hurry.
         */
        const val RAMP_UP_MS = 5_000L
    }

    /**
     * May fetching happen in the current network situation (default only Wi-Fi)? Exhaustive
     * without `else`, so that a new situation does not silently fall under allowed or forbidden
     * here.
     */
    private suspend fun networkAllowed(): Boolean = when (network.current()) {
        NetworkState.Kind.NO_NETWORK -> false
        NetworkState.Kind.WIFI      -> prefs.warmUpAllowed(PrewarmNetwork.WIFI).first()
        NetworkState.Kind.MOBILE     -> prefs.warmUpAllowed(PrewarmNetwork.MOBILE).first()
        NetworkState.Kind.ROAMING   -> prefs.warmUpAllowed(PrewarmNetwork.ROAMING).first()
    }

    /**
     * Still room below the limit? Asked before collecting so that a full store
     * does not cost list fetches on every start.
     */
    private fun hasSpaceLeft(): Boolean =
        preview.occupied() < PreviewMemory.LIMIT_WARM_UP

    /**
     * Is a pass worth it? Network and space before collecting — without space there would be
     * nothing to store, on the wrong network one would not be allowed to, and the list fetches would run
     * in vain.
     */
    suspend fun mayStart(): Boolean = networkAllowed() && hasSpaceLeft()

    /**
     * Fetch the passed addresses until the limit is reached. Silently: if something
     * fails, the store is simply less full. The caller provides the
     * background dispatcher.
     */
    suspend fun prewarm(addresses: List<String>) {
        val open = addresses
            .distinct()
            // Only what the store also keeps: what `isPreview` denies
            // the tap would not even write — fetching it would be
            // pure data volume without yield. And what already lies there does not need
            // the network once more.
            .filter { preview.isPreview(it) && !preview.has(it) }

        for (boost in open.chunked(CONCURRENT)) {
            // Measure anew per batch instead of once at the start: meanwhile
            // normal operation also stores images, and a counter that does
            // not see that would run past the limit.
            if (!hasSpaceLeft()) return
            // The network situation ALSO per batch, not only at the start: a pass
            // takes minutes, and whoever leaves the Wi-Fi meanwhile should not get the
            // rest of the collection over the data plan. The same
            // argument as for the limit one line above.
            if (!networkAllowed()) return
            coroutineScope { boost.map { async { fetch(it) } }.awaitAll() }
            delay(PAUSE_MS)
        }
    }

    /**
     * Fetch one image. The body is read and thrown away — the tap in
     * NetworkModule has already stored it at this point.
     */
    private fun fetch(address: String) {
        runCatching {
            val request = Request.Builder()
                .url(address)
                .tag(WarmUp::class.java, WarmUp)
                .build()
            // No `?.`: `body` is not nullable since OkHttp 5. The value
            // is discarded anyway — it is only read so that the response
            // runs completely through the cache.
            imageClient.newCall(request).execute().use { it.body.bytes() }
        }
    }
}
