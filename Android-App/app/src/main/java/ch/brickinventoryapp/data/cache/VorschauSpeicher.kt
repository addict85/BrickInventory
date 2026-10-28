package ch.brickinventoryapp.data.cache

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Dauerhafte Ablage der Vorschaubilder — damit die Tabellen ohne Netz stehen.
 * Coils Plattencache und der HTTP-Cache liegen unter `cacheDir`, den Android
 * jederzeit leeren darf, und beide sind LRU: Wer durch den Katalog blättert,
 * verdrängt die eigene Sammlung. Diese Ablage liegt unter `filesDir` und räumt nur
 * selbst. Keine Datenbank: Der Schlüssel ist die Adresse, gefragt wird nur „habe
 * ich die?“. Zusammenzuführen gibt es nichts — die App liest Bilder nur, und ob
 * die Kopie stimmt, klärt der ETag im HTTP-Cache.
 */
@Singleton
class VorschauSpeicher @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    companion object {
        /**
         * Obergrenze der Ablage: `filesDir` räumt niemand ausser uns. 150 MB fassen bei
         * rund 15 kB je Vorschau über zehntausend Bilder.
         */
        const val MAX_BYTES = 150L * 1024 * 1024

        /**
         * Beim Aufraeumen auf vier Fuenftel hinunter, statt jedes Mal knapp an der Grenze
         * zu arbeiten.
         */
        private const val ZIEL_ANTEIL = 0.8

        /**
         * So weit darf das Vorwärmen die Ablage füllen: 80 %. Nicht dasselbe wie
         * [ZIEL_ANTEIL] (wie tief das Aufräumen geht): Das letzte Fünftel bleibt dem, was
         * jemand wirklich ansieht, sonst löste jeder echte Aufruf ein Aufräumen aus.
         */
        const val GRENZE_VORWAERMEN = MAX_BYTES / 5 * 4

        /**
         * Zeitstempel für spekulativ geholte Bilder, kurz nach der Epoche: Aufgeräumt wird
         * das Älteste zuerst, und ein vorgewärmtes Bild soll vor einem wirklich
         * angesehenen fliegen. Wird es später angesehen, schreibt der Abgriff in
         * NetzModule es mit `spekulativ = false` neu und gibt ihm einen echten Stempel.
         * Nicht 0, weil manche Dateisysteme die Null nicht annehmen. Die Grenze oben
         * ganzzahlig, weil `const val` nur Konstantenausdrücke verträgt.
         */
        private const val SPEKULATIV_ZEIT = 1000L

        /** Nur Vorschaubilder. Die volle Aufloesung gehoert nicht hierher — siehe [istVorschau]. */
        private const val VORSCHAU_MERKMAL = "thumb"
    }

    private val ordner: File by lazy {
        File(context.filesDir, "vorschau").also { it.mkdirs() }
    }

    /**
     * Gehört diese Adresse zu einem Vorschaubild? Zwei Formen aus util/ImageUrls.kt:
     *
     * - der Proxy mit `&thumb=1`
     * - eine lokal abgelegte Datei, die der Server `_thumb` benannt hat
     *
     * Die volle Auflösung bleibt draussen: Sie wird einzeln im Detail angesehen, nicht
     * in Tabellen.
     */
    fun istVorschau(adresse: String): Boolean =
        adresse.contains("${VORSCHAU_MERKMAL}=1") || adresse.contains("_$VORSCHAU_MERKMAL.")

    /**
     * Der Dateiname zu einer Adresse — SHA-256, weil die Adresse einen kodierten
     * Fremdlink mit Schrägstrichen enthält; ein Hash hat ausserdem eine feste Länge.
     */
    private fun schluessel(adresse: String): String =
        MessageDigest.getInstance("SHA-256").digest(adresse.toByteArray())
            .joinToString("") { "%02x".format(it) }

    private fun datei(adresse: String) = File(ordner, schluessel(adresse))

    /**
     * Liegt diese Adresse schon hier? Für das Vorwärmen, ohne die Bytes zu lesen —
     * gefragt ist nur, ob es das Netz braucht.
     */
    fun hat(adresse: String): Boolean = datei(adresse).let { it.isFile && it.length() > 0 }

    /** Die abgelegten Bytes — oder null, wenn es sie nicht gibt. */
    fun lies(adresse: String): ByteArray? {
        val f = datei(adresse)
        return if (f.isFile && f.length() > 0) runCatching { f.readBytes() }.getOrNull() else null
    }

    /**
     * Bytes ablegen: erst in eine Nebendatei, dann umbenennen — sonst läge nach einem
     * Abbruch eine halbe Datei da, die wie ein Bild aussieht.
     */
    fun schreibe(adresse: String, bytes: ByteArray, spekulativ: Boolean = false) {
        if (bytes.isEmpty()) return
        runCatching {
            val ziel = datei(adresse)
            val temp = File(ordner, "${ziel.name}.tmp")
            temp.writeBytes(bytes)
            if (!temp.renameTo(ziel)) temp.delete()
            // Vorgewaermtes altert sofort — Begruendung an SPEKULATIV_ZEIT.
            else if (spekulativ) ziel.setLastModified(SPEKULATIV_ZEIT)
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
     * Über der Grenze? Dann die ältesten wegwerfen — nach der letzten Änderung, weil
     * viele Dateisysteme die Lesezeit nicht mehr führen. Was regelmässig gebraucht
     * wird, wird ohnehin neu geschrieben.
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
