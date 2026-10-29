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
 * In welcher Art Netz hängt das Gerät gerade? Für das Vorwärmen der Vorschaubilder
 * (VorschauVorwaermer), das sich je Lage erlauben lässt — Vorgabe nur WLAN. Drei
 * Lagen statt „ist online“: Ein Durchlauf kann die ganze Sammlung holen, und das
 * ist im Ausland eine Rechnung.
 *
 * Ein gemessenes WLAN zählt als Mobilfunk: Ein Hotspot sieht für das andere Gerät
 * aus wie WLAN, die Bytes kommen aber aus einem Datentarif
 * (`NET_CAPABILITY_NOT_METERED`), und „nur im WLAN“ meint diesen Fall nicht.
 *
 * `NET_CAPABILITY_NOT_ROAMING` gibt es erst ab API 28, die App läuft ab 26. Auf
 * Android 8.0 und 8.1 beantwortet `TelephonyManager` dieselbe Frage — ohne
 * Erlaubnis. Ohne diesen Rückfall griffe die Roaming-Einstellung dort still nicht.
 */
@Singleton
class Netzlage @Inject constructor(
    @param:ApplicationContext private val context: Context,
) {
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

    private fun istRoaming(faehig: NetworkCapabilities): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            !faehig.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING)
        } else {
            // Android 8.0/8.1 — siehe KDoc oben.
            val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
            tm?.isNetworkRoaming ?: false
        }
}
