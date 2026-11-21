package ch.brickinventoryapp.data

import android.content.Context
import ch.brickinventoryapp.data.repository.Ergebnis
import kotlinx.coroutines.delay
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * What kind of network is the device on? Warming the thumbnails can be
 * allowed per situation, because a pass abroad is a bill. A metered
 * Wi-Fi (hotspot) counts as mobile.
 */
@Singleton
class Netzlage internal constructor(private val measure: () -> Art) {
    /** The measurement via the ConnectivityManager; the internal path gives tests a fixed situation. */
    @Inject constructor(@ApplicationContext context: Context) : this({ miss(context) })

    /**
     * The four situations. They exclude each other — that is the reason for an
     * enumeration instead of three yes/no questions: the caller should not have to
     * decide itself what applies if two of them were true.
     */
    enum class Art { KEIN_NETZ, WLAN, MOBILE, ROAMING }

    fun aktuell(): Art = measure()

    /**
     * When a temporarily failed fetch is tried again: with a growing
     * pause, and without network not at all — then the store shows its state, and
     * waiting in fixed steps would only keep the loading indicator open.
     */
    @Singleton
    class Wiederholung internal constructor(
        private val netz: () -> Art,
        private val versuche: Int,
        private val firstPause: Long,
        private val wait: suspend (Long) -> Unit,
    ) {
        @Inject constructor(netzlage: Netzlage) : this(netzlage::aktuell, ATTEMPTS, FIRST_PAUSE_MS, { delay(it) })

        suspend fun <T> wiederhole(call: suspend () -> Ergebnis<T>): Ergebnis<T> {
            var pause = firstPause
            repeat(versuche - 1) {
                val r = call()
                if (r !is Ergebnis.Fehler || !r.transient || netz() == Art.KEIN_NETZ) return r
                wait(pause)
                pause = (pause * 2).coerceAtMost(HIGHEST_PAUSE_MS)
            }
            return call()
        }

        /** The same rule with fewer attempts — where someone waits for the answer and wants to page on. */
        fun atMost(n: Int): Wiederholung = Wiederholung(netz, n.coerceIn(1, versuche), firstPause, wait)

        companion object {
            const val ATTEMPTS = 5
            const val FIRST_PAUSE_MS = 1_000L
            const val HIGHEST_PAUSE_MS = 16_000L

            /** For tests and fetches that should not retry themselves: exactly one attempt. */
            val EINMAL = Wiederholung({ Art.WLAN }, 1, 0L, {})

            /** For tests: fixed situation, pauses are only recorded. */
            fun forTest(versuche: Int = ATTEMPTS, netz: () -> Art = { Art.WLAN },
                         wait: suspend (Long) -> Unit = {}) = Wiederholung(netz, versuche, FIRST_PAUSE_MS, wait)
        }
    }

    private companion object {
        fun miss(context: Context): Art {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                ?: return Art.KEIN_NETZ
            val netz = cm.activeNetwork ?: return Art.KEIN_NETZ
            val capable = cm.getNetworkCapabilities(netz) ?: return Art.KEIN_NETZ
            if (!capable.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) return Art.KEIN_NETZ

            val gemessen = !capable.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)

            return when {
                capable.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ->
                    if (isRoaming(capable)) Art.ROAMING else Art.MOBILE
                // Ethernet counts like Wi-Fi: fixed, unmetered, and on a
                // tablet in the docking station exactly what „at home" means.
                capable.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                    capable.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) ->
                    if (gemessen) Art.MOBILE else Art.WLAN
                // Something else (Bluetooth tethering, VPN without a recognizable
                // underlying network): treat cautiously as mobile. For a
                // setting that costs data volume, the default „rather
                // not" is the right direction for the unknown case.
                else -> Art.MOBILE
            }
        }

        fun isRoaming(capable: NetworkCapabilities): Boolean =
            !capable.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING)
    }
}
