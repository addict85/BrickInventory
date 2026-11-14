package ch.brickinventoryapp.update.util

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import ch.brickinventoryapp.model.json.BrickJson
import java.io.File
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

/**
 * Die Fassungsbeschreibung, wie der Signierjob sie ablegt: die Bytes der Beschreibung
 * (Base64) und die Signatur des eigenen Beschreibungsschlüssels. Wer nur Schreibrecht
 * am Repository hat, kann sie nicht fälschen. Ein Feld `signatur` älterer Releases
 * (APK-Schlüssel) wird überlesen.
 */
@Serializable
internal data class SignierteBeschreibung(
    @SerialName("daten") val daten: String,
    @SerialName("beschreibungssignatur") val beschreibungssignatur: String = "",
)

/**
 * Die Beschreibung, wenn einer der Beschreibungsschlüssel ([schluessel], SPKI) sie signiert
 * hat; sonst null. Die Signatur des APK-Schlüssels gilt nicht mehr: Ein Schlüssel signiert
 * nur einen Zweck, und ohne Übergangsweg kann ein erbeuteter APK-Schlüssel keine
 * Beschreibung mehr ausstellen. Erst prüfen, dann lesen: Ein ungeprüftes Feld darf nichts entscheiden.
 */
fun gepruefteBeschreibung(roh: String, schluessel: List<ByteArray>): UpdateBeschreibung? {
    val huelle = runCatching { BrickJson.decodeFromString<SignierteBeschreibung>(roh) }.getOrNull() ?: return null
    val daten = runCatching { Base64.getDecoder().decode(huelle.daten) }.getOrNull() ?: return null
    val signatur = runCatching { Base64.getDecoder().decode(huelle.beschreibungssignatur) }.getOrNull() ?: return null
    val echt = schluessel.any { beschreibungsSignaturGilt(daten, signatur, it) }
    if (!echt) return null
    return runCatching { BrickJson.decodeFromString<UpdateBeschreibung>(daten.decodeToString()) }.getOrNull()
}

/**
 * Die Beschreibungsschlüssel aus der PEM-Datei der App (res/raw/beschreibungs_schluessel.pem).
 * Mehrere zugleich, damit ein Wechsel ohne Lücke geht: Der neue steht in der App, bevor
 * der Workflow mit ihm signiert. Text ausserhalb der Blöcke zählt nicht.
 */
fun beschreibungsSchluessel(pem: String): List<ByteArray> =
    Regex("""-----BEGIN PUBLIC KEY-----([A-Za-z0-9+/=\s]+)-----END PUBLIC KEY-----""").findAll(pem)
        .mapNotNull { block -> runCatching { Base64.getMimeDecoder().decode(block.groupValues[1].trim()) }.getOrNull() }
        .toList()

/** ECDSA mit SHA-256, wie `openssl dgst -sha256 -sign` im Signierjob; andere Verfahren gelten nicht. */
internal fun beschreibungsSignaturGilt(daten: ByteArray, signatur: ByteArray, spki: ByteArray): Boolean = runCatching {
    val schluessel = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(spki))
    Signature.getInstance("SHA256withECDSA").run {
        initVerify(schluessel)
        update(daten)
        verify(signatur)
    }
}.getOrDefault(false)

/** Trägt die Datei genau die signierte Prüfsumme? Leer heisst: keine Angabe, also nein. */
fun pruefsummePasst(datei: File, erwartet: String): Boolean {
    if (erwartet.isBlank() || !datei.isFile) return false
    val md = MessageDigest.getInstance("SHA-256")
    datei.inputStream().use { ein ->
        val puffer = ByteArray(64 * 1024)
        while (true) {
            val n = ein.read(puffer)
            if (n < 0) break
            md.update(puffer, 0, n)
        }
    }
    return md.digest().joinToString("") { "%02x".format(it) } == erwartet.trim().lowercase()
}
