package ch.brickinventoryapp.sicherheit

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** Ob die WebAuthn-Optionen eines Servers zur eingerichteten Adresse gehören. */
enum class RpIdFinding { PASST, MISSING, FOREIGN }

/**
 * Der Credential Manager signiert für jede Domain, deren assetlinks.json diese App
 * nennt — nicht nur für den eingerichteten Server. Ein fremder Server könnte die
 * Optionen des echten durchreichen und mit der Antwort dort anmelden. Darum muss
 * die rpId genau der Host der Adresse sein (der Server setzt rpID = Hostname).
 */
fun checkRpId(optionen: JsonObject, serverUrl: String): RpIdFinding {
    val feld = optionen["rpId"] ?: (optionen["rp"] as? JsonObject)?.get("id")
    val rpId = (feld as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.isNotBlank() }
        ?: return RpIdFinding.MISSING
    val host = serverUrl.trim().toHttpUrlOrNull()?.host ?: return RpIdFinding.FOREIGN
    return if (rpId == host) RpIdFinding.PASST else RpIdFinding.FOREIGN
}

/** Der Host der Adresse, für die Meldung. */
fun hostOf(serverUrl: String): String = serverUrl.trim().toHttpUrlOrNull()?.host ?: serverUrl
