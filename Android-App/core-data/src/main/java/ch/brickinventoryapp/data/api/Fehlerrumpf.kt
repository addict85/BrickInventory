package ch.brickinventoryapp.data.api

/**
 * Was der Server bei einem Fehler in den Rumpf legt: `{success:false, error, code}`.
 *
 * `error` ist ein Satz in der Sprache des Kontos und zum Anzeigen da; `code`
 * ist der Name des Falls (utils/fehlerTexte.ts) und zum Verzweigen. Wer nach
 * dem Fall entscheidet, nimmt den Code — der Satz wechselt mit Sprache und
 * Wortlaut, der Code nicht.
 */
data class Fehlerrumpf(val text: String?, val code: String?) {
    companion object {
        /** Kein JSON, leerer Rumpf oder fehlende Felder ergeben jeweils null. */
        fun lies(roh: String?): Fehlerrumpf {
            if (roh.isNullOrBlank()) return Fehlerrumpf(null, null)
            val obj = runCatching { org.json.JSONObject(roh) }.getOrNull() ?: return Fehlerrumpf(null, null)
            fun feld(name: String) = obj.optString(name).takeIf { obj.has(name) && !obj.isNull(name) && it.isNotBlank() }
            return Fehlerrumpf(feld("error"), feld("code"))
        }
    }
}
