package ch.brickinventoryapp.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import ch.brickinventoryapp.data.repository.Outcome
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.delay
import javax.inject.Inject
import javax.inject.Singleton

/**
 * What kind of network is the device on? Warming the thumbnails can be
 * allowed per situation, because a pass abroad is a bill. A metered
 * Wi-Fi (hotspot) counts as mobile.
 */
@Singleton
class NetworkState internal constructor(private val measure: () -> Kind) {
    /** The measurement via the ConnectivityManager; the internal path gives tests a fixed situation. */
    @Inject constructor(@ApplicationContext context: Context) : this({ miss(context) })

    /**
     * The four situations. They exclude each other — that is the reason for an
     * enumeration instead of three yes/no questions: the caller should not have to
     * decide itself what applies if two of them were true.
     */
    enum class Kind { NO_NETWORK, WIFI, MOBILE, ROAMING }

    fun current(): Kind = measure()

    /**
     * When a temporarily failed fetch is tried again: with a growing
     * pause, and without network not at all — then the store shows its state, and
     * waiting in fixed steps would only keep the loading indicator open.
     */
    @Singleton
    class RetryPolicy internal constructor(
        private val network: () -> Kind,
        private val attempts: Int,
        private val firstPause: Long,
        private val wait: suspend (Long) -> Unit,
    ) {
        @Inject constructor(networkState: NetworkState) : this(networkState::current, ATTEMPTS, FIRST_PAUSE_MS, { delay(it) })

        suspend fun <T> retry(call: suspend () -> Outcome<T>): Outcome<T> {
            var pause = firstPause
            repeat(attempts - 1) {
                val r = call()
                if (r !is Outcome.Failure || !r.transient || network() == Kind.NO_NETWORK) return r
                wait(pause)
                pause = (pause * 2).coerceAtMost(HIGHEST_PAUSE_MS)
            }
            return call()
        }

        /** The same rule with fewer attempts — where someone waits for the answer and wants to page on. */
        fun atMost(n: Int): RetryPolicy = RetryPolicy(network, n.coerceIn(1, attempts), firstPause, wait)

        companion object {
            const val ATTEMPTS = 5
            const val FIRST_PAUSE_MS = 1_000L
            const val HIGHEST_PAUSE_MS = 16_000L

            /** For tests and fetches that should not retry themselves: exactly one attempt. */
            val ONCE = RetryPolicy({ Kind.WIFI }, 1, 0L, {})

            /** For tests: fixed situation, pauses are only recorded. */
            fun forTest(attempts: Int = ATTEMPTS, network: () -> Kind = { Kind.WIFI },
                         wait: suspend (Long) -> Unit = {}) = RetryPolicy(network, attempts, FIRST_PAUSE_MS, wait)
        }
    }

    private companion object {
        fun miss(context: Context): Kind {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                ?: return Kind.NO_NETWORK
            val network = cm.activeNetwork ?: return Kind.NO_NETWORK
            val capable = cm.getNetworkCapabilities(network) ?: return Kind.NO_NETWORK
            if (!capable.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) return Kind.NO_NETWORK

            val measured = !capable.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)

            return when {
                capable.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ->
                    if (isRoaming(capable)) Kind.ROAMING else Kind.MOBILE
                // Ethernet counts like Wi-Fi: fixed, unmetered, and on a
                // tablet in the docking station exactly what „at home" means.
                capable.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                    capable.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) ->
                    if (measured) Kind.MOBILE else Kind.WIFI
                // Something else (Bluetooth tethering, VPN without a recognizable
                // underlying network): treat cautiously as mobile. For a
                // setting that costs data volume, the default „rather
                // not" is the right direction for the unknown case.
                else -> Kind.MOBILE
            }
        }

        fun isRoaming(capable: NetworkCapabilities): Boolean =
            !capable.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING)
    }
}
