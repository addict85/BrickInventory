package ch.brickinventoryapp.security

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** Whether a server's WebAuthn options belong to the configured address. */
enum class RpIdFinding { MATCHES, MISSING, FOREIGN }

/**
 * The Credential Manager signs for every domain whose assetlinks.json names this
 * app — not only for the configured server. A foreign server could pass through the
 * options of the real one and sign in there with the response. That is why
 * the rpId must be exactly the host of the address (the server sets rpID = hostname).
 */
fun checkRpId(options: JsonObject, serverUrl: String): RpIdFinding {
    val field = options["rpId"] ?: (options["rp"] as? JsonObject)?.get("id")
    val rpId = (field as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.isNotBlank() }
        ?: return RpIdFinding.MISSING
    val host = serverUrl.trim().toHttpUrlOrNull()?.host ?: return RpIdFinding.FOREIGN
    return if (rpId == host) RpIdFinding.MATCHES else RpIdFinding.FOREIGN
}

/** The host of the address, for the message. */
fun hostOf(serverUrl: String): String = serverUrl.trim().toHttpUrlOrNull()?.host ?: serverUrl
