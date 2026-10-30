package ch.brickinventoryapp.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.telephony.TelephonyManager
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * In welcher Art Netz hängt das Gerät? Das Vorwärmen der Vorschaubilder lässt sich
 * je Lage erlauben, denn ein Durchlauf im Ausland ist eine Rechnung. Ein gemessenes
 * WLAN (Hotspot) zählt als Mobilfunk; unter API 28 beantwortet TelephonyManager die
 * Roaming-Frage.
 */
@Singleton
class Netzlage @Inject constructor(
    @param:ApplicationContext private val context: Context,
) : Netzkennung {
    /**
     * Die vier Lagen. Sie schliessen einander aus — das ist der Grund fuer eine
     * Aufzaehlung statt dreier Ja/Nein-Fragen: Der Aufrufer soll nicht selbst
     * entscheiden muessen, was gilt, wenn zwei davon zutraefen.
     */
    enum class Art { KEIN_NETZ, WLAN, MOBIL, ROAMING }

    fun aktuell(): Art {
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

    /**
     * Art, Standardtor, DNS-Server und Suchdomäne des aktiven Netzes, gehasht.
     * Ohne Standortrecht gibt Android keine SSID heraus; diese Merkmale bleiben im
     * selben WLAN über Verbindungen gleich und unterscheiden Heim- und Hotelnetz.
     * Ein Angreifer, der sie nachbaut, fällt nicht auf — die Rückfrage ist eine
     * zweite Hürde nach dem Serverbeweis, keine Garantie.
     */
    override fun fingerabdruck(): String? = runCatching {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return null
        val netz = cm.activeNetwork ?: return null
        val lp = cm.getLinkProperties(netz) ?: return null
        val faehig = cm.getNetworkCapabilities(netz)
        val art = when {
            faehig == null -> "?"
            faehig.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wlan"
            faehig.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "lan"
            faehig.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "mobil"
            else -> "anders"
        }
        val tore = lp.routes.filter { it.isDefaultRoute }.mapNotNull { it.gateway?.hostAddress }.sorted()
        val dns = lp.dnsServers.mapNotNull { it.hostAddress }.sorted()
        val roh = "$art|${tore.joinToString(",")}|${dns.joinToString(",")}|${lp.domains.orEmpty()}"
        java.security.MessageDigest.getInstance("SHA-256").digest(roh.toByteArray())
            .joinToString("") { "%02x".format(it) }.take(16)
    }.getOrNull()

    private fun istRoaming(faehig: NetworkCapabilities): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            !faehig.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING)
        } else {
            // Android 8.0/8.1 — siehe KDoc oben.
            val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
            tm?.isNetworkRoaming ?: false
        }
}
