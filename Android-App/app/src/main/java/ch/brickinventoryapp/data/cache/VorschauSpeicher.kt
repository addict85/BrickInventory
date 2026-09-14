package ch.brickinventoryapp.data.cache

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Dauerhafte Ablage der Vorschaubilder — damit die Tabellen ohne Netz stehen.
 *
 * ── Marcos Anforderung ──────────────────────────────────────────────────────
 * „Die Android-App soll auch ohne Internet funktionieren." Und zum Umfang:
 * „nur fuer Vorschau Bilder."
 *
 * ── Warum ein Speicher und nicht noch ein Cache ─────────────────────────────
 *
 * Die App hatte schon zwei Zwischenspeicher fuer Bilder: Coils Plattencache und
 * den HTTP-Cache von OkHttp, beide 50 MB, beide unter `cacheDir`. Das Wort
 * steht dort nicht zufaellig: Was unter `cacheDir` liegt, darf Android
 * jederzeit loeschen, wenn der Speicher knapp wird — ohne Rueckfrage, ohne
 * Reihenfolge, auch genau das, was man morgen offline braucht. Und beide sind
 * LRU: Wer durch den Katalog blaettert, verdraengt damit die Bilder der eigenen
 * Sammlung.
 *
 * Diese Ablage liegt unter `filesDir`. Das ist der ganze Unterschied zwischen
 * „meistens noch da" und „da". Android raeumt dort nichts weg; geloescht wird
 * nur, was diese Klasse selbst loescht.
 *
 * ── Warum KEINE Datenbank ───────────────────────────────────────────────────
 *
 * Naheliegend waere Room gewesen. Der Nutzen einer Datenbank ist ein
 * durchsuchbarer Index — und bei einem Bild IST der Index schon der
 * Dateiname: Der Schluessel ist die Adresse, und mehr wird nie gefragt als
 * „habe ich die?". Groesse und Alter stehen im Dateisystem.
 *
 * Room haette dafuer eine neue Abhaengigkeit samt Annotationsverarbeitung
 * gebracht, und es gibt in diesem Projekt keine zweite Stelle, die davon
 * profitierte. Diese Klasse laesst sich spaeter hinter derselben Schnittstelle
 * auf eine Datenbank umstellen, falls je etwas dazukommt, das man WIRKLICH
 * abfragen muss.
 *
 * ── Kein Zusammenfuehren noetig ─────────────────────────────────────────────
 *
 * Eine lokale Ablage wirft sonst die Frage auf, was gilt, wenn sich beide
 * Seiten geaendert haben. Hier nicht: Die App LIEST Bilder nur. Es gibt genau
 * eine Stelle, die sie aendern kann — den Server —, also ist nichts
 * zusammenzufuehren. Ob die eigene Kopie noch stimmt, beantwortet der ETag —
 * und zwar im HTTP-Zwischenspeicher von OkHttp, der die bedingte Anfrage
 * ohnehin fuehrt. Diese Ablage muss ihn deshalb gar nicht kennen.
 */
@Singleton
class VorschauSpeicher @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    companion object {
        /**
         * Obergrenze der Ablage.
         *
         * Sie muss sein: `filesDir` raeumt niemand ausser uns, und ein
         * Katalog mit 25'000 Sets liesse sie sonst unbegrenzt wachsen. 150 MB
         * fassen bei rund 15 kB je Vorschau ueber zehntausend Bilder — weit
         * mehr als eine Sammlung braucht, und wenig gegenueber dem, was eine
         * einzige Filmdatei belegt.
         */
        const val MAX_BYTES = 150L * 1024 * 1024

        /** Beim Aufraeumen auf vier Fuenftel hinunter, statt jedes Mal knapp an der Grenze zu arbeiten. */
        private const val ZIEL_ANTEIL = 0.8

        /** Nur Vorschaubilder. Die volle Aufloesung gehoert nicht hierher — siehe [istVorschau]. */
        private const val VORSCHAU_MERKMAL = "thumb"
    }

    private val ordner: File by lazy {
        File(context.filesDir, "vorschau").also { it.mkdirs() }
    }

    /**
     * Gehoert diese Adresse zu einem Vorschaubild?
     *
     * Zwei Formen, beide aus util/ImageUrls.kt:
     *   • der Proxy mit `&thumb=1`
     *   • eine lokal abgelegte Datei, die der Server als `_thumb` benannt hat
     *
     * Die volle Aufloesung bleibt draussen: Sie wird einzeln im Detaildialog
     * angesehen, nicht in Tabellen, und ein paar hundert davon fuellten die
     * Ablage mit etwas, das offline niemand vermisst.
     */
    fun istVorschau(adresse: String): Boolean =
        adresse.contains("${VORSCHAU_MERKMAL}=1") || adresse.contains("_$VORSCHAU_MERKMAL.")

    /**
     * Der Dateiname zu einer Adresse.
     *
     * SHA-256 statt der Adresse selbst: Die Adresse enthaelt einen
     * URL-kodierten Fremdlink mit Schraegstrichen und Prozentzeichen und taugt
     * nicht als Dateiname. Ein Hash ist ausserdem gleich lang, was die
     * Pfadlaenge berechenbar macht.
     */
    private fun schluessel(adresse: String): String =
        MessageDigest.getInstance("SHA-256").digest(adresse.toByteArray())
            .joinToString("") { "%02x".format(it) }

    private fun datei(adresse: String) = File(ordner, schluessel(adresse))

    /** Die abgelegten Bytes — oder null, wenn es sie nicht gibt. */
    fun lies(adresse: String): ByteArray? {
        val f = datei(adresse)
        return if (f.isFile && f.length() > 0) runCatching { f.readBytes() }.getOrNull() else null
    }

    /**
     * Bytes ablegen. Erst in eine Nebendatei, dann umbenennen — sonst liegt
     * nach einem Abbruch eine halbe Datei da, und die sieht aus wie ein Bild.
     *
     * Dieselbe Vorsicht wie im Bild-Proxy des Servers, wo genau das schon
     * einmal passiert ist.
     */
    fun schreibe(adresse: String, bytes: ByteArray) {
        if (bytes.isEmpty()) return
        runCatching {
            val ziel = datei(adresse)
            val temp = File(ordner, "${ziel.name}.tmp")
            temp.writeBytes(bytes)
            if (!temp.renameTo(ziel)) temp.delete()
        }
        aufraeumenFallsNoetig()
    }

    /** Wie viel liegt hier? Fuer die Anzeige in den Einstellungen. */
    fun belegt(): Long =
        runCatching { ordner.listFiles()?.sumOf { it.length() } ?: 0L }.getOrDefault(0L)

    /** Alles wegwerfen — fuer den Knopf in den Einstellungen. */
    fun leeren() {
        runCatching { ordner.listFiles()?.forEach { it.delete() } }
    }

    /**
     * Ueber der Grenze? Dann die aeltesten wegwerfen.
     *
     * Nach der letzten AENDERUNG, nicht nach dem letzten Lesen: Android fuehrt
     * die Lesezeit auf vielen Dateisystemen gar nicht mehr nach. Das ist
     * gutmuetig genug — was regelmaessig gebraucht wird, wird auch
     * regelmaessig neu geholt und damit neu geschrieben.
     */
    private fun aufraeumenFallsNoetig() {
        runCatching {
            val dateien = ordner.listFiles()?.toList() ?: return
            var summe = dateien.sumOf { it.length() }
            if (summe <= MAX_BYTES) return
            val ziel = (MAX_BYTES * ZIEL_ANTEIL).toLong()
            for (f in dateien.sortedBy { it.lastModified() }) {
                if (summe <= ziel) break
                val gross = f.length()
                if (f.delete()) summe -= gross
            }
        }
    }
}
