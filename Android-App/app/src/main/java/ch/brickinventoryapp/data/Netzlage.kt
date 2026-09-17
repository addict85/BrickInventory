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
 * In welcher Art Netz haengt das Geraet gerade?
 *
 * ── Wofuer ──────────────────────────────────────────────────────────────────
 *
 * Fuer das Vorwaermen der Vorschaubilder (VorschauVorwaermer). Marcos Vorgabe:
 * „Bitte nur im WLAN vorwaermen oder noch besser in den Optionen einstellbar.
 * Insbesondere auch ob WLAN, Mobilfunk und oder Roaming erlaubt ist. Standard
 * auf WLAN."
 *
 * Drei Lagen statt eines blossen „ist online": Ein Durchlauf kann beim ersten
 * Mal die ganze Sammlung holen, und das ist im Ausland eine Rechnung.
 *
 * ── Warum ein gemessenes WLAN als Mobilfunk zaehlt ──────────────────────────
 *
 * Ein Telefon, das seinen Hotspot aufspannt, sieht fuer das andere Geraet aus
 * wie WLAN — die Bytes kommen aber aus einem Datentarif. Android sagt das
 * ausdruecklich (`NET_CAPABILITY_NOT_METERED`), und wer „nur im WLAN" einstellt,
 * meint genau diesen Fall nicht mit. Ein gemessenes WLAN faellt deshalb unter
 * [Art.MOBIL].
 *
 * ── Die Falle bei minSdk 26 ─────────────────────────────────────────────────
 *
 * `NET_CAPABILITY_NOT_ROAMING` gibt es erst ab API 28. Diese App laeuft ab 26.
 * Auf Android 8.0 und 8.1 beantwortet deshalb `TelephonyManager` dieselbe
 * Frage — nicht veraltet, ohne Erlaubnis, und seit jeher vorhanden. Ohne diesen
 * Rueckfall haette die Roaming-Einstellung auf alten Geraeten stillschweigend
 * nicht gegriffen, und das faellt niemandem auf, bis die Rechnung kommt.
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
