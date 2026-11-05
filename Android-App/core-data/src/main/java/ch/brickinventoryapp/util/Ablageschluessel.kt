package ch.brickinventoryapp.util

import java.io.File
import java.io.IOException
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Der Schlüssel der lokalen Ablagen (Bestand, Antwort-Cache, Widget): 32 Zufallsbytes,
 * auf der Platte nur vom Keystore umhüllt ([tresor], eigener Alias). Ein Keystore-Aufruf
 * je Prozess statt einer je Datei; verschlüsselt wird in Software mit einem Schlüssel,
 * der lesbar nur im Speicher der App liegt. Je Zweck ein abgeleiteter ([fuer]).
 */
class Ablageschluessel(private val datei: File, private val tresor: TokenVerschluesselung) {
    @Volatile private var bekannt: ByteArray? = null

    /** Eben neu angelegt: Was mit einem früheren Schlüssel verschlüsselt lag, ist nicht mehr lesbar. */
    @Volatile var neuAngelegt: Boolean = false
        private set

    @Synchronized
    fun hole(): ByteArray {
        bekannt?.let { return it }
        if (datei.isFile) {
            when (val befund = tresor.oeffne(datei.readText().trim())) {
                is Tresorbefund.Lesbar -> hexZuBytes(befund.klartext)?.takeIf { it.size == LAENGE }?.let { bekannt = it; return it }
                // Nicht neu anlegen: Das risse die verschlüsselte Datenbank samt Ausgang mit.
                Tresorbefund.Gesperrt -> throw IOException("Keystore gerade nicht bereit")
                Tresorbefund.Weg -> Unit
            }
        }
        val neu = ByteArray(LAENGE).also(SecureRandom()::nextBytes)
        datei.parentFile?.mkdirs()
        val tmp = File(datei.parentFile, datei.name + ".tmp")
        tmp.writeText(tresor.verschluessle(neu.joinToString("") { "%02x".format(it) }))
        if (!tmp.renameTo(datei)) throw IOException("Ablageschlüssel nicht geschrieben")
        neuAngelegt = true
        bekannt = neu
        return neu
    }

    /** Zählt die Erneuerungen; wer einen abgeleiteten Schlüssel hält, merkt so, dass er veraltet ist. */
    @Volatile var stand: Long = 0
        private set

    private val vorErneuerung = java.util.concurrent.CopyOnWriteArrayList<() -> Unit>()

    /** Für Ablagen, die den Schlüssel länger halten als einen Zugriff (die Datenbank): zu und weg damit. */
    fun vorErneuerung(hoerer: () -> Unit) { vorErneuerung += hoerer }

    /**
     * Krypto-Shredding beim Abmelden: Ein neuer Schlüssel macht alles unlesbar, was mit dem
     * alten verschlüsselt lag, auch gelöschte Reste auf dem Flash. Unter der Sperre, damit
     * niemand dazwischen mit dem alten Schlüssel neu öffnet.
     */
    @Synchronized
    fun erneuere() {
        vorErneuerung.forEach { it() }
        datei.delete()
        runCatching { tresor.vergiss() }
        bekannt = null
        stand++
        hole()
    }

    /** Abgeleitet mit HMAC-SHA256: Datenbank und Dateien teilen keinen Schlüssel. */
    fun fuer(zweck: String): ByteArray = Mac.getInstance("HmacSHA256").run {
        init(SecretKeySpec(hole(), "HmacSHA256"))
        doFinal(zweck.toByteArray(Charsets.UTF_8))
    }

    private companion object {
        const val LAENGE = 32
        fun hexZuBytes(hex: String): ByteArray? =
            if (hex.length % 2 != 0 || hex.any { it !in "0123456789abcdef" }) null
            else ByteArray(hex.length / 2) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    }
}

/**
 * AES-256-GCM für Dateien der App. Format: Kennung ‖ IV ‖ Geheimtext samt Tag. Die
 * Bindung (Zweck und Dateiname) geht als AAD ein: Eine Datei unter fremdem Namen
 * scheitert an der Prüfung, statt als die andere gelesen zu werden. Ohne
 * Kennung gilt eine Datei als Altbestand im Klartext; der Aufrufer verwirft sie.
 */
class AblageChiffre(private val schluessel: () -> ByteArray) {

    fun verschluessle(klartext: ByteArray, bindung: String): ByteArray {
        val iv = ByteArray(IV_LAENGE).also(SecureRandom()::nextBytes)
        val c = Cipher.getInstance(VERFAHREN)
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(schluessel(), "AES"), GCMParameterSpec(TAG_BITS, iv))
        c.updateAAD(bindung.toByteArray(Charsets.UTF_8))
        return KENNUNG + iv + c.doFinal(klartext)
    }

    /** null, wenn die Daten nicht von hier stammen, verändert, anders gebunden oder mit einem anderen Schlüssel sind. */
    fun entschluessle(daten: ByteArray, bindung: String): ByteArray? = oeffne(daten, KENNUNG, bindung)

    /**
     * Nur zur einmaligen Übernahme: die Fassung ohne Bindung (Kennung 1). Wer so
     * liest, legt die Daten sofort gebunden neu ab, damit kein Altbestand bleibt.
     */
    fun entschluessleUngebunden(daten: ByteArray): ByteArray? = oeffne(daten, KENNUNG_UNGEBUNDEN, null)

    private fun oeffne(daten: ByteArray, kennung: ByteArray, bindung: String?): ByteArray? {
        if (daten.size <= kennung.size + IV_LAENGE || !daten.copyOfRange(0, kennung.size).contentEquals(kennung)) return null
        return runCatching {
            val c = Cipher.getInstance(VERFAHREN)
            c.init(Cipher.DECRYPT_MODE, SecretKeySpec(schluessel(), "AES"),
                GCMParameterSpec(TAG_BITS, daten, kennung.size, IV_LAENGE))
            if (bindung != null) c.updateAAD(bindung.toByteArray(Charsets.UTF_8))
            c.doFinal(daten, kennung.size + IV_LAENGE, daten.size - kennung.size - IV_LAENGE)
        }.getOrNull()
    }

    private companion object {
        const val VERFAHREN = "AES/GCM/NoPadding"
        const val IV_LAENGE = 12
        const val TAG_BITS = 128
        val KENNUNG = byteArrayOf('B'.code.toByte(), 'I'.code.toByte(), 'A'.code.toByte(), 2)
        val KENNUNG_UNGEBUNDEN = byteArrayOf('B'.code.toByte(), 'I'.code.toByte(), 'A'.code.toByte(), 1)
    }
}
