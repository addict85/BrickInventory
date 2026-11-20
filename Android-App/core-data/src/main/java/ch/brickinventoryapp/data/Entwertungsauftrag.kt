package ch.brickinventoryapp.data

import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.security.Tresorbefund

/**
 * Was eine spätere Entwertung braucht: der Server, dem das Token gehört, das Token
 * nur verschlüsselt, der Pin dieses Servers und die Herkunft, an die das Token
 * gebunden ist. Passt [herkunft] nicht zu [serverUrl], geht das Token nirgends hin (Entwerter).
 */
data class Entwertungsauftrag(
    val serverUrl: String,
    val tokenSecret: String,
    val pin: String? = null,
    val herkunft: String? = NetworkPolicy.herkunft(serverUrl),
)

/** Was der Arbeiter aus seiner Eingabe liest. */
internal sealed interface JobState {
    data class Da(val job: Entwertungsauftrag) : JobState

    /** Der Schlüssel arbeitet erst nach dem Entsperren; Warten darauf ist kein Fehlversuch. */
    data object Gesperrt : JobState

    /** Nichts Lesbares: kein Ziel, an das sich das Token schicken liesse. */
    data object Unlesbar : JobState
}

/**
 * Der Auftrag als ein Geheimtext unter dem Schlüssel der Angaben. Die Datenbank von
 * WorkManager ist nicht verschlüsselt; stünde die Adresse in den Eingabedaten, verriete
 * sie jedem, der die Datei liest, wo das Konto liegt.
 */
internal class Auftragsablage(
    private val verschluessle: (wert: String, bindung: String) -> String?,
    private val oeffne: (geheim: String, bindung: String) -> Tresorbefund,
) {
    /** null: gerade nicht verschlüsselbar (gesperrt); dann wird nichts in die Warteschlange gelegt. */
    fun ablegen(job: Entwertungsauftrag): String? = verschluessle(asText(job), BINDING)

    fun lies(geheim: String): JobState = when (val b = oeffne(geheim, BINDING)) {
        is Tresorbefund.Readable -> fromText(b.klartext)?.let { JobState.Da(it) } ?: JobState.Unlesbar
        Tresorbefund.Gesperrt -> JobState.Gesperrt
        Tresorbefund.Weg -> JobState.Unlesbar
    }

    private companion object {
        const val BINDING = "entwertungsauftrag"
        const val VERSION = "1"

        // Zeilen statt JSON: Adresse, Base64 und Herkunft enthalten keinen Zeilenumbruch,
        // und so bleibt die Form ohne Serialisierung prüfbar. Leer heisst „kein Wert“.
        fun asText(a: Entwertungsauftrag): String =
            listOf(VERSION, a.serverUrl, a.tokenSecret, a.pin.orEmpty(), a.herkunft.orEmpty()).joinToString("\n")

        fun fromText(text: String): Entwertungsauftrag? {
            val teile = text.split('\n')
            if (teile.size != 5 || teile[0] != VERSION || teile[1].isBlank() || teile[2].isBlank()) return null
            val pin = teile[3].ifEmpty { null }
            // Ohne Herkunft wie bei Aufträgen älterer Fassungen: die des Servers (Standardwert).
            return if (teile[4].isEmpty()) Entwertungsauftrag(teile[1], teile[2], pin)
                else Entwertungsauftrag(teile[1], teile[2], pin, teile[4])
        }
    }
}
