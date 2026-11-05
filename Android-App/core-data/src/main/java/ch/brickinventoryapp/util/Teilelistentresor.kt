package ch.brickinventoryapp.util

import java.io.File
import java.io.IOException
import javax.inject.Inject

/** Die verschlüsselte Teileliste in filesDir/pdf; ältere Fassungen legten `teileliste.pdf` im Klartext ab. */
const val TEILELISTE_DATEI = "teileliste.bin"

/**
 * Die Teileliste trägt das ganze Inventar. Auf der Platte liegt sie darum nur mit
 * AES-GCM verschlüsselt; Klartext gibt es nur im Speicher, solange eine App sie über
 * den TeilelistenProvider liest. Die Bindung an den Zweck lässt keine andere Ablage
 * unter diesem Namen als Teileliste gelten.
 */
class Teilelistentresor(private val chiffre: AblageChiffre) {
    @Inject constructor(ablage: Ablageschluessel) : this(AblageChiffre { ablage.fuer(ZWECK) })

    /** Legt [pdf] verschlüsselt ab; erst das Umbenennen macht die neue Liste sichtbar. */
    fun lege(intern: File, extern: File?, pdf: ByteArray): File {
        val ziel = teilelistenAblage(intern, extern)
        val tmp = File(ziel.parentFile, ziel.name + ".tmp")
        tmp.writeBytes(chiffre.verschluessle(pdf, ZWECK))
        if (!tmp.renameTo(ziel)) {
            tmp.delete()
            throw IOException("Teileliste nicht abgelegt")
        }
        return ziel
    }

    /** Der Klartext oder null, wenn keine (lesbare) Teileliste da ist. */
    fun lies(intern: File): ByteArray? {
        val datei = File(File(intern, "pdf"), TEILELISTE_DATEI)
        if (!datei.isFile) return null
        return chiffre.entschluessle(datei.readBytes(), ZWECK)
    }

    private companion object {
        const val ZWECK = "teileliste"
    }
}

/**
 * Kopiert ab [versatz] höchstens [laenge] Bytes aus [inhalt] nach [ziel] und gibt
 * die Zahl zurück, 0 am Ende. So liest der Proxy-Deskriptor des Providers: Die
 * Ziel-App darf springen, die Liste liegt dabei nur im Speicher.
 */
fun liesAusSpeicher(inhalt: ByteArray, versatz: Long, laenge: Int, ziel: ByteArray): Int {
    if (versatz < 0 || laenge < 0) throw IOException("Ungültiger Lesebereich")
    if (versatz >= inhalt.size) return 0
    val n = minOf(laenge.toLong(), inhalt.size - versatz, ziel.size.toLong()).toInt()
    System.arraycopy(inhalt, versatz.toInt(), ziel, 0, n)
    return n
}
