package ch.brickinventoryapp.data

import android.content.Context
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
class Netzlage internal constructor(private val messen: () -> Art) {
    /** Die Messung über den ConnectivityManager; der interne Weg gibt Tests eine feste Lage. */
    @Inject constructor(@ApplicationContext context: Context) : this({ miss(context) })

    /**
     * Die vier Lagen. Sie schliessen einander aus — das ist der Grund fuer eine
     * Aufzaehlung statt dreier Ja/Nein-Fragen: Der Aufrufer soll nicht selbst
     * entscheiden muessen, was gilt, wenn zwei davon zutraefen.
     */
    enum class Art { KEIN_NETZ, WLAN, MOBIL, ROAMING }

    fun aktuell(): Art = messen()

    private companion object {
        fun miss(context: Context): Art {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                ?: return Art.KEIN_NETZ
            val netz = cm.activeNetwork ?: return Art.KEIN_NETZ
            val faehig = cm.getNetworkCapabilities(netz) ?: return Art.KEIN_NETZ
            if (!faehig.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) return Art.KEIN_NETZ

            val gemessen = !faehig.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)

            return when {
                faehig.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ->
                    if (istRoaming(faehig)) Art.ROAMING else Art.MOBIL
                // Ethernet zaehlt wie WLAN: fest, ungemessen, und auf einem
                // Tablet in der Dockingstation genau das, was „zu Hause" meint.
                faehig.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                    faehig.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) ->
                    if (gemessen) Art.MOBIL else Art.WLAN
                // Etwas anderes (Bluetooth-Tethering, VPN ohne erkennbaren
                // Untergrund): vorsichtig als Mobilfunk behandeln. Bei einer
                // Einstellung, die Datenvolumen kostet, ist die Vorgabe „lieber
                // nicht" die richtige Richtung fuer den unbekannten Fall.
                else -> Art.MOBIL
            }
        }

        fun istRoaming(faehig: NetworkCapabilities): Boolean =
            !faehig.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING)
    }
}
