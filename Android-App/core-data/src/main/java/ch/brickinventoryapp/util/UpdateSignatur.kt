package ch.brickinventoryapp.util

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.security.MessageDigest
import java.security.Signature
import java.security.cert.CertificateFactory
import java.util.Base64

/**
 * Die Fassungsbeschreibung, wie der Signierjob sie ablegt: die Bytes der
 * Beschreibung (Base64) und ihre Signatur mit dem Release-Schlüssel der App.
 * Wer nur Schreibrecht am Repository hat, kann sie nicht fälschen; Adresse und
 * Prüfsumme des APK darin sind damit so vertrauenswürdig wie das APK selbst.
 */
@Serializable
data class SignierteBeschreibung(
    @SerialName("daten") val daten: String,
    @SerialName("signatur") val signatur: String,
)

/**
 * Die Beschreibung, wenn eines der [zertifikate] (DER, die Signierer der
 * installierten App) sie signiert hat; sonst null. Erst prüfen, dann lesen:
 * Ein ungeprüftes Feld darf nichts entscheiden.
 */
fun gepruefteBeschreibung(roh: String, zertifikate: List<ByteArray>): UpdateBeschreibung? {
    val huelle = runCatching { beschreibungsJson.decodeFromString<SignierteBeschreibung>(roh) }.getOrNull() ?: return null
    val daten = runCatching { Base64.getDecoder().decode(huelle.daten) }.getOrNull() ?: return null
    val signatur = runCatching { Base64.getDecoder().decode(huelle.signatur) }.getOrNull() ?: return null
    if (zertifikate.none { signaturGilt(daten, signatur, it) }) return null
    return runCatching { beschreibungsJson.decodeFromString<UpdateBeschreibung>(daten.decodeToString()) }.getOrNull()
}

/** SHA-256 mit RSA oder ECDSA, je nach Schlüssel des Zertifikats — so signiert openssl im Workflow. */
fun signaturGilt(daten: ByteArray, signatur: ByteArray, zertifikat: ByteArray): Boolean = runCatching {
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
