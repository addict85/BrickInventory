package ch.brickinventoryapp.util

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.cert.CertificateFactory
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

/**
 * Die Fassungsbeschreibung, wie der Signierjob sie ablegt: die Bytes der
 * Beschreibung (Base64) und ihre Signaturen. `beschreibungssignatur` stammt vom
 * eigenen Beschreibungsschlüssel, `signatur` vom APK-Schlüssel, nur noch für
 * Fassungen, die keinen Beschreibungsschlüssel kennen. Wer nur Schreibrecht am
 * Repository hat, kann keine der beiden fälschen.
 */
@Serializable
internal data class SignierteBeschreibung(
    @SerialName("daten") val daten: String,
    @SerialName("signatur") val signatur: String = "",
    @SerialName("beschreibungssignatur") val beschreibungssignatur: String = "",
)

/**
 * Die Beschreibung, wenn sie echt ist; sonst null. Kennt die App Beschreibungsschlüssel
 * ([schluessel], SPKI), gilt nur deren Signatur: Der APK-Schlüssel signiert dann nichts,
 * was die App als Beschreibung annimmt (Schlüsseltrennung). Nur ohne sie gilt
 * der Übergangsweg über die Signierer der installierten App ([zertifikate], DER).
 * Erst prüfen, dann lesen: Ein ungeprüftes Feld darf nichts entscheiden.
 */
fun gepruefteBeschreibung(roh: String, zertifikate: List<ByteArray>, schluessel: List<ByteArray>): UpdateBeschreibung? {
    val huelle = runCatching { beschreibungsJson.decodeFromString<SignierteBeschreibung>(roh) }.getOrNull() ?: return null
    val daten = runCatching { Base64.getDecoder().decode(huelle.daten) }.getOrNull() ?: return null
    val echt = if (schluessel.isNotEmpty()) {
        val signatur = runCatching { Base64.getDecoder().decode(huelle.beschreibungssignatur) }.getOrNull() ?: return null
        schluessel.any { beschreibungsSignaturGilt(daten, signatur, it) }
    } else {
        val signatur = runCatching { Base64.getDecoder().decode(huelle.signatur) }.getOrNull() ?: return null
        zertifikate.any { signaturGilt(daten, signatur, it) }
    }
    if (!echt) return null
    return runCatching { beschreibungsJson.decodeFromString<UpdateBeschreibung>(daten.decodeToString()) }.getOrNull()
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

/** SHA-256 mit RSA oder ECDSA, je nach Schlüssel des Zertifikats — so signiert openssl im Workflow. */
internal fun signaturGilt(daten: ByteArray, signatur: ByteArray, zertifikat: ByteArray): Boolean = runCatching {
    val schluessel = CertificateFactory.getInstance("X.509").generateCertificate(zertifikat.inputStream()).publicKey
    val verfahren = when (schluessel.algorithm) {
        "RSA" -> "SHA256withRSA"
        "EC" -> "SHA256withECDSA"
        else -> null
    }
    verfahren != null && Signature.getInstance(verfahren).run {
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

private val beschreibungsJson = Json { ignoreUnknownKeys = true }
