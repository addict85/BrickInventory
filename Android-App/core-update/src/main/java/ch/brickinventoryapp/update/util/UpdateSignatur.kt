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
 * The version description, as the signing job stores it: the description's bytes
 * (base64) and the signature of its own description key. Whoever only has write
 * access to the repository cannot forge it. A `signatur` field from older releases
 * (APK key) is skipped over.
 */
@Serializable
internal data class SignedDescription(
    @SerialName("daten") val daten: String,
    @SerialName("beschreibungssignatur") val beschreibungssignatur: String = "",
)

/**
 * The description, if one of the description keys ([schluessel], SPKI) has signed
 * it; otherwise null. The APK key's signature no longer counts: a key only signs
 * for one purpose, and without a transition path a stolen APK key can no longer
 * issue a description. Check first, then read: an unchecked field must not decide anything.
 */
fun checkedDescription(roh: String, schluessel: List<ByteArray>): UpdateBeschreibung? {
    val shell = runCatching { BrickJson.decodeFromString<SignedDescription>(roh) }.getOrNull() ?: return null
    val daten = runCatching { Base64.getDecoder().decode(shell.daten) }.getOrNull() ?: return null
    val signatur = runCatching { Base64.getDecoder().decode(shell.beschreibungssignatur) }.getOrNull() ?: return null
    val echt = schluessel.any { descriptionSignatureApplies(daten, signatur, it) }
    if (!echt) return null
    return runCatching { BrickJson.decodeFromString<UpdateBeschreibung>(daten.decodeToString()) }.getOrNull()
}

/**
 * The description keys from the app's PEM file (res/raw/beschreibungs_schluessel.pem).
 * Several at once, so a change can happen without a gap: the new one is in the app
 * before the workflow signs with it. Text outside the blocks doesn't count.
 */
fun descriptionKey(pem: String): List<ByteArray> =
    Regex("""-----BEGIN PUBLIC KEY-----([A-Za-z0-9+/=\s]+)-----END PUBLIC KEY-----""").findAll(pem)
        .mapNotNull { block -> runCatching { Base64.getMimeDecoder().decode(block.groupValues[1].trim()) }.getOrNull() }
        .toList()

/** ECDSA with SHA-256, as `openssl dgst -sha256 -sign` in the signing job; other methods don't count. */
internal fun descriptionSignatureApplies(daten: ByteArray, signatur: ByteArray, spki: ByteArray): Boolean = runCatching {
    val schluessel = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(spki))
    Signature.getInstance("SHA256withECDSA").run {
        initVerify(schluessel)
        update(daten)
        verify(signatur)
    }
}.getOrDefault(false)

/** Does the file carry exactly the signed checksum? Empty means: no value given, so no. */
fun checksumFits(datei: File, erwartet: String): Boolean {
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
