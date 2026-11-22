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
 * access to the repository cannot forge it. A `signature` field from older releases
 * (APK key) is skipped over.
 */
@Serializable
internal data class SignedDescription(
    @SerialName("daten") val data: String,
    @SerialName("beschreibungssignatur") val descriptionSignature: String = "",
)

/**
 * The description, if one of the description keys ([key], SPKI) has signed
 * it; otherwise null. The APK key's signature no longer counts: a key only signs
 * for one purpose, and without a transition path a stolen APK key can no longer
 * issue a description. Check first, then read: an unchecked field must not decide anything.
 */
fun checkedDescription(raw: String, key: List<ByteArray>): UpdateDescription? {
    val shell = runCatching { BrickJson.decodeFromString<SignedDescription>(raw) }.getOrNull() ?: return null
    val data = runCatching { Base64.getDecoder().decode(shell.data) }.getOrNull() ?: return null
    val signature = runCatching { Base64.getDecoder().decode(shell.descriptionSignature) }.getOrNull() ?: return null
    val real = key.any { descriptionSignatureApplies(data, signature, it) }
    if (!real) return null
    return runCatching { BrickJson.decodeFromString<UpdateDescription>(data.decodeToString()) }.getOrNull()
}

/**
 * The description keys from the app's PEM file (res/raw/description_key.pem).
 * Several at once, so a change can happen without a gap: the new one is in the app
 * before the workflow signs with it. Text outside the blocks doesn't count.
 */
fun descriptionKey(pem: String): List<ByteArray> =
    Regex("""-----BEGIN PUBLIC KEY-----([A-Za-z0-9+/=\s]+)-----END PUBLIC KEY-----""").findAll(pem)
        .mapNotNull { block -> runCatching { Base64.getMimeDecoder().decode(block.groupValues[1].trim()) }.getOrNull() }
        .toList()

/** ECDSA with SHA-256, as `openssl dgst -sha256 -sign` in the signing job; other methods don't count. */
internal fun descriptionSignatureApplies(data: ByteArray, signature: ByteArray, spki: ByteArray): Boolean = runCatching {
    val key = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(spki))
    Signature.getInstance("SHA256withECDSA").run {
        initVerify(key)
        update(data)
        verify(signature)
    }
}.getOrDefault(false)

/** Does the file carry exactly the signed checksum? Empty means: no value given, so no. */
fun checksumFits(file: File, expected: String): Boolean {
    if (expected.isBlank() || !file.isFile) return false
    val md = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { one ->
        val buffer = ByteArray(64 * 1024)
        while (true) {
            val n = one.read(buffer)
            if (n < 0) break
            md.update(buffer, 0, n)
        }
    }
    return md.digest().joinToString("") { "%02x".format(it) } == expected.trim().lowercase()
}
