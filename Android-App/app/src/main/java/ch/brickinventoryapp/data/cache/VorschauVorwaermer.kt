package ch.brickinventoryapp.data.cache

import ch.brickinventoryapp.data.PreferencesManager
import ch.brickinventoryapp.data.repository.BrickRepository
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.util.resolveThumbUrl
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
 * sie. Diese Klasse dreht das um: Sie laeuft einmal je App-Start durch die
 * eigene Sammlung und holt, was noch fehlt.
 *
 * ── Welche Reiter, und warum der Katalog NICHT dabei ist ────────────────────
 *
 * Vorgewaermt wird die EIGENE Sammlung, ueber alle Reiter, die Kacheln zeigen:
 * Galerie (Sets), Teile, Minifiguren und die manuell erfassten Teile und
 * Figuren — letztere erscheinen auch im Finanzen-Reiter, es sind dieselben
 * Bilder.
 *
 * Der Katalog bleibt draussen, und das ist eine Entscheidung und kein
 * Versehen: Er ist nicht die Sammlung, sondern das Verzeichnis ALLER Sets, die
 * es gibt — rund 25'000. Bei etwa 15 kB je Vorschau waeren das ueber 350 MB,
 * also mehr als das Doppelte der ganzen Ablage und ein Vielfaches der Grenze
 * in [VorschauSpeicher.GRENZE_VORWAERMEN]. Das Vorwaermen wuerde also
 * mittendrin abbrechen, haette dabei das Mobilfunkvolumen aufgebraucht und
 * ausgerechnet die eigene Sammlung verdraengt. Der Katalog bedient sich
 * weiterhin beim Blaettern, wie bisher.
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
    private val repo: BrickRepository,
    private val prefs: PreferencesManager,
    private val vorschau: VorschauSpeicher,
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

        /**
         * Seitengroesse der Galerie-Abfrage — bewusst GENAU die der Galerie.
         *
         * ── Warum keine eigene, groessere Zahl ──────────────────────────────
         *
         * `getSets()` legt die ungefilterte ERSTE SEITE unter dem Schluessel
         * „sets" im ResponseCache ab, und daraus bedient sich die Galerie nach
         * einem Neustart. Die Bedingung dafuer prueft Konto, Suche, Thema,
         * Sortierung und Seitennummer — die Seitengroesse aber NICHT.
         *
         * Mit einer eigenen Zahl haette das Vorwaermen der Galerie also ihren
         * eigenen Cache-Eintrag unter dem Ruecken weggeschrieben, gefuellt mit
         * einer anders grossen Seite. Mit derselben Zahl ist der Aufruf
         * Byte fuer Byte derselbe, den die Galerie ohnehin macht — er kann
         * dort nichts kaputt machen.
         */
        private const val SEITE = ch.brickinventoryapp.data.repository.GALLERY_PAGE_SIZE

        /**
         * Die Seitengroesse, mit der [ch.brickinventoryapp.data.repository.TeileRepository.getParts]
         * FEST abfragt — sie laesst sich von aussen nicht setzen. Steht hier,
         * damit „kuerzere Antwort = letzte Seite" nicht an einer nackten Zahl
         * haengt, die niemand mit ihrer Quelle verbindet.
         */
        private const val TEILE_SEITE = 500

        /** Notbremse gegen eine Sammlung, die es so nicht geben sollte. */
        private const val MAX_SEITEN = 50
    }

    /**
     * Einmal durch die Sammlung. Laeuft still: Faellt etwas aus, ist die Ablage
     * eben weniger voll — es gibt nichts zu melden und niemanden zu stoeren.
     *
     * Der Aufrufer sorgt fuer den Hintergrund-Dispatcher (MainViewModel).
     */
    suspend fun vorwaermen() {
        val basis = runCatching { prefs.serverUrl.first() }.getOrNull().orEmpty()
        if (basis.isBlank()) return
        // Die Grenze GILT SCHON HIER: Ist die Ablage bereits voll genug, wird
        // gar nicht erst die Sammlung abgefragt. Sonst kostete jeder App-Start
        // vier Listenabrufe, um danach nichts zu tun.
        if (vorschau.belegt() >= VorschauSpeicher.GRENZE_VORWAERMEN) return

        val adressen = sammleAdressen(basis)
        for (schub in adressen.chunked(GLEICHZEITIG)) {
            // Je Schub neu messen statt einmal am Anfang: Waehrenddessen legt
            // auch der normale Betrieb Bilder ab, und ein Zaehler, der das
            // nicht sieht, liefe an der Grenze vorbei.
            if (vorschau.belegt() >= VorschauSpeicher.GRENZE_VORWAERMEN) return
            coroutineScope { schub.map { async { hole(it) } }.awaitAll() }
            delay(PAUSE_MS)
        }
    }

    /**
     * Die Adressen aller Kacheln der eigenen Sammlung — ohne die, die schon
     * hier liegen.
     *
     * `distinct()` ist nicht kosmetisch: Dasselbe Teil in zwei Farben teilt
     * sich dieselbe Bildadresse, und in einer grossen Sammlung sind das
     * Tausende doppelter Abrufe.
     */
    private suspend fun sammleAdressen(basis: String): List<String> {
        val roh = mutableListOf<String?>()

        var seite = 1
        while (seite <= MAX_SEITEN) {
            val liste = daten(repo.sets.getSets(page = seite, pageSize = SEITE))?.sets.orEmpty()
            liste.mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }
            if (liste.size < SEITE) break
            seite++
        }

        seite = 1
        while (seite <= MAX_SEITEN) {
            val liste = daten(repo.teile.getParts(page = seite))?.parts.orEmpty()
            liste.mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }
            // getParts() fragt fest mit pageSize = 500 — eine kuerzere Antwort
            // ist damit die letzte Seite.
            if (liste.size < TEILE_SEITE) break
            seite++
        }

        daten(repo.teile.getMinifigs())?.figs.orEmpty()
            .mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }

        daten(repo.teile.getManualParts())?.parts.orEmpty()
            .mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }

        daten(repo.teile.getManualMinifigs())?.figs.orEmpty()
            .mapTo(roh) { resolveThumbUrl(basis, it.imageLocal, it.imageUrl) }

        return roh.filterNotNull()
            .distinct()
            // Nur was die Ablage auch behaelt: Was `istVorschau` verneint,
            // wuerde der Abgriff gar nicht erst schreiben — es zu holen waere
            // reines Datenvolumen ohne Ertrag.
            .filter { vorschau.istVorschau(it) && !vorschau.hat(it) }
    }

    /**
     * Der Inhalt einer geglueckten Antwort, sonst null.
     *
     * Fuenfmal gebraucht, und bewusst mit `when` statt `as? Result.Success`:
     * Ohne Typargument haengt die Umwandlung an der Typinferenz, und
     * SettingsFeature.kt haelt in einem Kommentar fest, dass sie dort nicht
     * getragen hat. Ein `when` auf der versiegelten Klasse kommt ohne
     * Umwandlung aus und kann diese Frage gar nicht erst stellen.
     */
    private fun <T> daten(a: Result<T>): T? = when (a) {
        is Result.Success -> a.data
        else -> null
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
