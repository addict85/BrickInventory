package ch.brickinventoryapp.network.data.api

import ch.brickinventoryapp.model.domain.Fehlercode
/**
 * What the server puts in the body on an error: `{success:false, error, code}`.
 *
 * `error` is a sentence in the account's language, there to be shown; `code`
 * is the case's name (utils/fehlerTexte.ts), there to branch on. Whoever
 * decides by the case takes the code — the sentence changes with language
 * and wording, the code does not.
 */
data class Fehlerrumpf(val text: String?, val code: String?) {
    /** The code as an enum value; one the app doesn't know is null. */
    val errorCode: Fehlercode? get() = Fehlercode.aus(code)

    companion object {
        /** No JSON, an empty body or missing fields each give null. */
        fun lies(roh: String?): Fehlerrumpf {
            if (roh.isNullOrBlank()) return Fehlerrumpf(null, null)
            val obj = runCatching { org.json.JSONObject(roh) }.getOrNull() ?: return Fehlerrumpf(null, null)
            fun feld(name: String) = obj.optString(name).takeIf { obj.has(name) && !obj.isNull(name) && it.isNotBlank() }
            return Fehlerrumpf(feld("error"), feld("code"))
        }
    }
}
