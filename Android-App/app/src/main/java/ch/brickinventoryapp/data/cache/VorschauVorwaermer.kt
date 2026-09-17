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
 * Marke an einer Anfrage, die nur VORWAERMT.
 *
 * Ein OkHttp-Tag und keine Kopfzeile: Tags bleiben auf dem Geraet, eine
 * Kopfzeile ginge an den Server und erzaehlte ihm etwas, das ihn nichts
 * angeht. Gelesen wird die Marke im Abgriff in AppModule — er entscheidet
 * daran, ob das Bild spekulativ oder echt gebraucht abgelegt wird.
 */
object Vorwaermung

/**
 * Bilder im Hintergrund holen, bevor jemand sie aufruft.
 *
 * ── Marcos Anforderung ──────────────────────────────────────────────────────
 * „Ergaenzen dass die Android-App bereits im Hintergrund Bilder cached auch
 * wenn diese noch nicht aufgerufen wurden aus allen Reiter. Dabei soll nicht
 * mehr als 80% des Speichercaches genutzt werden."
 *
 * ── Warum das nicht dasselbe ist wie der bestehende Abgriff ─────────────────
 *
 * Die Ablage fuellte sich bisher NUR als Nebenwirkung des Hinsehens: Was
 * einmal auf dem Bildschirm war, lag danach auch offline vor. Wer die App
 * online nie geoeffnet hat, hatte offline nichts — und genau dann braucht man
 * sie. Diese Klasse dreht das um.
 *
 * ── Was hier NICHT entschieden wird ─────────────────────────────────────────
 *
 * WELCHE Bilder — das steht in ui/VorwaermenFeature.kt und gehoert dorthin:
 * Die Auswahl haengt am Kontofilter des Haushalts (`scopeFor`), und der lebt
 * im Zustand des MainViewModel. Die erste Fassung fragte die Reiter hier
 * unten selbst ab und liess den Filter dabei weg; GalerieLaedtGefiltertTest
 * und ListenfilterImZustandTest haben genau das gemeldet. Zu Recht: Ein
 * zweiter Ladeweg, der den Filter nicht kennt, ist der Fehler, gegen den
 * beide Regeln gebaut sind.
 *
 * Hier unten bleibt, was wirklich Datenschicht ist: holen, drosseln, und die
 * Grenze einhalten.
 *
 * ── Warum ohne Coil ─────────────────────────────────────────────────────────
 *
 * Coil wuerde jedes Bild entpacken und in den Speicher-Cache legen. Gebraucht
 * wird davon nichts: Das Ziel sind Bytes auf der Platte. Der blosse
 * OkHttp-Aufruf nimmt denselben Weg durch dieselbe Kette — der Abgriff in
 * AppModule legt die Antwort ab — nur ohne Bitmap und ohne den Speicher-Cache
 * mit Bildern zu fuellen, die gerade niemand sieht.
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
         * Wie viele Bilder gleichzeitig.
         *
         * Der Bild-Client laeuft mit `maxRequestsPerHost = 6`. Zwei davon fuer
         * die Vorwaermung laesst vier fuer das, was gerade auf dem Bildschirm
         * steht. Hoeher waere schneller fertig und dabei genau das, was diese
         * Klasse nicht sein darf: etwas, das die sichtbare App ausbremst.
         */
        private const val GLEICHZEITIG = 2

        /** Nach jedem Schub kurz Luft lassen — dieselbe Ruecksicht wie oben. */
        private const val PAUSE_MS = 250L

        /**
         * Erst nach dieser Zeit anfangen.
         *
         * Beim App-Start konkurriert alles um dieselbe Leitung: Anmeldung,
         * Dashboard, die erste sichtbare Kachelwand. Die Vorwaermung hat es
         * als Einzige nicht eilig.
         */
        const val ANLAUF_MS = 5_000L
    }

    /**
     * Darf in der aktuellen Netzlage geholt werden?
     *
     * Marcos Vorgabe: „Bitte nur im WLAN vorwaermen oder noch besser in den
     * Optionen einstellbar. Insbesondere auch ob WLAN, Mobilfunk und oder
     * Roaming erlaubt ist. Standard auf WLAN."
     *
     * Erschoepfend ueber die Aufzaehlung, ohne `else`: Kaeme eine fuenfte Lage
     * dazu, soll der Uebersetzer sie hier melden, statt dass sie stillschweigend
     * unter „erlaubt" oder „verboten" faellt.
     */
    private suspend fun netzErlaubt(): Boolean = when (netz.aktuell()) {
        Netzlage.Art.KEIN_NETZ -> false
        Netzlage.Art.WLAN      -> prefs.vorwaermenWlan.first()
        Netzlage.Art.MOBIL     -> prefs.vorwaermenMobil.first()
        Netzlage.Art.ROAMING   -> prefs.vorwaermenRoaming.first()
    }

    /**
     * Ist ueberhaupt noch Platz unter der Grenze?
     *
     * Vor dem Sammeln gefragt, damit ein voller Speicher nicht bei jedem
     * App-Start vier Listenabrufe kostet, um danach nichts zu tun.
     */
    private fun nochPlatz(): Boolean =
        vorschau.belegt() < VorschauSpeicher.GRENZE_VORWAERMEN

    /**
     * Lohnt sich ein Durchlauf ueberhaupt? Beides zusammen, VOR dem Sammeln.
     *
     * Zwei getrennte Fragen hinter einem Tor, und jede hat ihren eigenen Grund:
     * Ohne Platz gaebe es nichts abzulegen, im falschen Netz duerfte man nicht.
     * Beide hier zu stellen erspart bei jedem App-Start vier Listenabrufe, die
     * sonst umsonst liefen.
     */
    suspend fun darfStarten(): Boolean = netzErlaubt() && nochPlatz()

    /**
     * Die uebergebenen Adressen holen, bis die Grenze erreicht ist.
     *
     * Laeuft still: Faellt etwas aus, ist die Ablage eben weniger voll — es
     * gibt nichts zu melden und niemanden zu stoeren. Der Aufrufer sorgt fuer
     * den Hintergrund-Dispatcher.
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
     * ihn zu diesem Zeitpunkt schon der Abgriff in AppModule.
     */
    private fun hole(adresse: String) {
        runCatching {
            val anfrage = Request.Builder()
                .url(adresse)
                .tag(Vorwaermung::class.java, Vorwaermung)
                .build()
            bildClient.newCall(anfrage).execute().use { it.body?.bytes() }
        }
    }
}
