package ch.brickinventoryapp.network.data.api

import ch.brickinventoryapp.model.domain.ErrorCode
/**
 * What the server puts in the body on an error: `{success:false, error, code}`.
 *
 * `error` is a sentence in the account's language, there to be shown; `code`
 * is the case's name (`utils/fehlerTexte.ts`), there to branch on. Whoever
 * decides by the case takes the code — the sentence changes with language
 * and wording, the code does not.
 */
data class ErrorBody(val text: String?, val code: String?) {
    /** The code as an enum value; one the app doesn't know is null. */
    val errorCode: ErrorCode? get() = ErrorCode.from(code)

    companion object {
        /** No JSON, an empty body or missing fields each give null. */
        fun read(raw: String?): ErrorBody {
            if (raw.isNullOrBlank()) return ErrorBody(null, null)
            val obj = runCatching { org.json.JSONObject(raw) }.getOrNull() ?: return ErrorBody(null, null)
            fun field(name: String) = obj.optString(name).takeIf { obj.has(name) && !obj.isNull(name) && it.isNotBlank() }
            return ErrorBody(field("error"), field("code"))
        }
    }
}
