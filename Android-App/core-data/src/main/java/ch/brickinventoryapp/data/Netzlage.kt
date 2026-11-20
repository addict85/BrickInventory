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
 * In welcher Art Netz hängt das Gerät? Das Vorwärmen der Vorschaubilder lässt sich
 * je Lage erlauben, denn ein Durchlauf im Ausland ist eine Rechnung. Ein gemessenes
 * WLAN (Hotspot) zählt als Mobilfunk.
 */
@Singleton
class Netzlage internal constructor(private val measure: () -> Art) {
    /** Die Messung über den ConnectivityManager; der interne Weg gibt Tests eine feste Lage. */
    @Inject constructor(@ApplicationContext context: Context) : this({ miss(context) })

    /**
     * Die vier Lagen. Sie schliessen einander aus — das ist der Grund fuer eine
     * Aufzaehlung statt dreier Ja/Nein-Fragen: Der Aufrufer soll nicht selbst
     * entscheiden muessen, was gilt, wenn zwei davon zutraefen.
     */
    enum class Art { KEIN_NETZ, WLAN, MOBILE, ROAMING }

    fun aktuell(): Art = measure()

    /**
     * Wann ein vorübergehend gescheiterter Abruf noch einmal geht: mit wachsender
     * Pause, und ohne Netz gar nicht — dann zeigt die Ablage ihren Stand, und ein
     * Warten in festen Schritten hielte nur die Ladeanzeige offen.
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

        /** Dieselbe Regel mit weniger Versuchen — wo jemand auf die Antwort wartet und weiterblättern will. */
        fun atMost(n: Int): Wiederholung = Wiederholung(netz, n.coerceIn(1, versuche), firstPause, wait)

        companion object {
            const val ATTEMPTS = 5
            const val FIRST_PAUSE_MS = 1_000L
            const val HIGHEST_PAUSE_MS = 16_000L

            /** Für Tests und Abrufe, die selbst nicht wiederholen sollen: genau ein Versuch. */
            val EINMAL = Wiederholung({ Art.WLAN }, 1, 0L, {})

            /** Für Tests: feste Lage, Pausen werden nur mitgeschrieben. */
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
                // Ethernet zaehlt wie WLAN: fest, ungemessen, und auf einem
                // Tablet in der Dockingstation genau das, was „zu Hause" meint.
                capable.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                    capable.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) ->
                    if (gemessen) Art.MOBILE else Art.WLAN
                // Etwas anderes (Bluetooth-Tethering, VPN ohne erkennbaren
                // Untergrund): vorsichtig als Mobilfunk behandeln. Bei einer
                // Einstellung, die Datenvolumen kostet, ist die Vorgabe „lieber
                // nicht" die richtige Richtung fuer den unbekannten Fall.
                else -> Art.MOBILE
            }
        }

        fun isRoaming(capable: NetworkCapabilities): Boolean =
            !capable.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING)
    }
}
