package ch.brickinventoryapp.data.cache

import ch.brickinventoryapp.data.Netzlage
import ch.brickinventoryapp.data.PreferencesManager
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import okhttp3.OkHttpClient
import okhttp3.Request
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton

/**
 * Marke an einer Anfrage, die nur vorwärmt. Ein OkHttp-Tag statt einer Kopfzeile,
 * weil es den Server nichts angeht. Der Abgriff in NetzModule legt danach
 * spekulativ oder gebraucht ab.
 */
object Vorwaermung

/**
 * Bilder im Hintergrund holen, bevor jemand sie aufruft, aus allen Reitern und bis
 * 80 % der Ablage: Sonst lag offline nur vor, was einmal auf dem Bildschirm war.
 * Welche Bilder, entscheidet ui/Vorwaermen.kt, weil die Auswahl am Kontofilter
 * hängt; hier bleibt holen, drosseln und die Grenze. Ohne Coil: Gebraucht werden
 * Bytes auf der Platte, keine Bitmaps im Speicher-Cache.
 */
@Singleton
class VorschauVorwaermer @Inject constructor(
    private val vorschau: VorschauSpeicher,
    private val netz: Netzlage,
    private val prefs: PreferencesManager,
    @param:Named("image") private val bildClient: OkHttpClient,
) {
    companion object {
        /**
         * Zwei gleichzeitig: Der Bild-Client hat sechs je Host, vier bleiben für das
         * Sichtbare — die Vorwärmung soll die App nicht ausbremsen.
         */
        private const val GLEICHZEITIG = 2

        /** Nach jedem Schub kurz Luft lassen — dieselbe Ruecksicht wie oben. */
        private const val PAUSE_MS = 250L

        /**
         * Erst nach dieser Zeit anfangen: Beim Start konkurrieren Anmeldung und erste
         * Kachelwand um die Leitung, die Vorwärmung hat es nicht eilig.
         */
        const val ANLAUF_MS = 5_000L
    }

    /**
     * Darf in der aktuellen Netzlage geholt werden (Vorgabe nur WLAN)? Erschöpfend
     * ohne `else`, damit eine neue Lage hier nicht still unter erlaubt oder verboten
     * fällt.
     */
    private suspend fun netzErlaubt(): Boolean = when (netz.aktuell()) {
        Netzlage.Art.KEIN_NETZ -> false
        Netzlage.Art.WLAN      -> prefs.vorwaermenWlan.first()
        Netzlage.Art.MOBIL     -> prefs.vorwaermenMobil.first()
        Netzlage.Art.ROAMING   -> prefs.vorwaermenRoaming.first()
    }

    /**
     * Noch Platz unter der Grenze? Vor dem Sammeln gefragt, damit ein voller Speicher
     * nicht bei jedem Start Listenabrufe kostet.
     */
    private fun nochPlatz(): Boolean =
        vorschau.belegt() < VorschauSpeicher.GRENZE_VORWAERMEN

    /**
     * Lohnt sich ein Durchlauf? Netz und Platz vor dem Sammeln — ohne Platz gäbe es
     * nichts abzulegen, im falschen Netz dürfte man nicht, und die Listenabrufe liefen
     * umsonst.
     */
    suspend fun darfStarten(): Boolean = netzErlaubt() && nochPlatz()

    /**
     * Die übergebenen Adressen holen, bis die Grenze erreicht ist. Still: Fällt etwas
     * aus, ist die Ablage eben weniger voll. Der Aufrufer sorgt für den
     * Hintergrund-Dispatcher.
     */
    suspend fun vorwaermen(adressen: List<String>) {
        val offen = adressen
            .distinct()
            // Nur was die Ablage auch behaelt: Was `istVorschau` verneint,
            // wuerde der Abgriff gar nicht erst schreiben — es zu holen waere
            // reines Datenvolumen ohne Ertrag. Und was schon daliegt, braucht
            // das Netz nicht noch einmal.
            .filter { vorschau.istVorschau(it) && !vorschau.hat(it) }

        for (schub in offen.chunked(GLEICHZEITIG)) {
            // Je Schub neu messen statt einmal am Anfang: Waehrenddessen legt
            // auch der normale Betrieb Bilder ab, und ein Zaehler, der das
            // nicht sieht, liefe an der Grenze vorbei.
            if (!nochPlatz()) return
            // Die Netzlage AUCH je Schub, nicht nur am Anfang: Ein Durchlauf
            // dauert Minuten, und wer dabei aus dem WLAN geht, soll nicht den
            // Rest der Sammlung ueber den Datentarif bekommen. Dasselbe
            // Argument wie bei der Grenze eine Zeile darueber.
            if (!netzErlaubt()) return
            coroutineScope { schub.map { async { hole(it) } }.awaitAll() }
            delay(PAUSE_MS)
        }
    }

    /**
     * Ein Bild holen. Der Rumpf wird gelesen und weggeworfen — abgelegt hat
     * ihn zu diesem Zeitpunkt schon der Abgriff in NetzModule.
     */
    private fun hole(adresse: String) {
        runCatching {
            val anfrage = Request.Builder()
                .url(adresse)
                .tag(Vorwaermung::class.java, Vorwaermung)
                .build()
            // Kein `?.`: `body` ist seit OkHttp 5 nicht nullbar. Der Wert
            // wird ohnehin verworfen — gelesen wird nur, damit die Antwort
            // vollstaendig durch den Zwischenspeicher laeuft.
            bildClient.newCall(anfrage).execute().use { it.body.bytes() }
        }
    }
}
