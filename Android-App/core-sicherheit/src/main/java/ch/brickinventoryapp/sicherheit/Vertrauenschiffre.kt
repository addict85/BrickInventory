package ch.brickinventoryapp.sicherheit

import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Die zwei Schlüssel der Geräteablage, die das Abmelden überleben.
 *
 * [schluessel] (Vertrauen) arbeitet auch bei gesperrtem Gerät: Pins und der Nutzer-CA-Schalter
 * entscheiden über jede TLS-Verbindung, und die Namen der Pin-Einträge leiten sich davon ab.
 * Jeder Fehler (Keystore gesperrt, Wert verändert, unter fremdem Namen abgelegt) ergibt null —
 * der Aufrufer fällt auf „nicht vertraut“ zurück.
 *
 * [angaben] arbeitet nur entsperrt: Server-Adresse, Benutzername, Herkunft des Tokens,
 * Widget-Zahlen und Abmeldeaufträge verraten, wo das Konto liegt; ein gesperrtes Gerät gibt
 * sie nicht heraus. Darum mit drei Ausgängen ([oeffneAngabe]): Gesperrt heisst warten.
 * Ohne eigenen (Tests) gilt der Vertrauensschlüssel auch für die Angaben.
 */
class Vertrauenschiffre(
    angaben: (() -> ByteArray)? = null,
    schluessel: () -> ByteArray,
) {
    private val chiffre = AblageChiffre(schluessel)
    private val vertrauen = schluessel
    private val angaben: () -> ByteArray = angaben ?: schluessel

    fun verschluessle(wert: String, bindung: String): String? = runCatching {
        Base64.getEncoder().encodeToString(chiffre.verschluessle(wert.toByteArray(Charsets.UTF_8), ZWECK + bindung))
    }.getOrNull()

    fun entschluessle(gespeichert: String, bindung: String): String? = runCatching {
        chiffre.entschluessle(Base64.getDecoder().decode(gespeichert), ZWECK + bindung)?.toString(Charsets.UTF_8)
    }.getOrNull()

    /**
     * Ein Name für einen Eintrag, der nichts über [bindung] verrät (etwa Host und Port eines
     * Pins). HMAC unter einem eigenen, abgeleiteten Schlüssel; null, wenn der Keystore nicht kann.
     */
    fun name(bindung: String): String? = runCatching {
        val namensschluessel = hmac(vertrauen(), NAMEN)
        Base64.getUrlEncoder().withoutPadding().encodeToString(hmac(namensschluessel, bindung)).take(NAME_LAENGE)
    }.getOrNull()

    /** null, wenn der Schlüssel gerade nicht arbeitet (gesperrt): Dann wird nichts abgelegt. */
    fun verschluessleAngabe(wert: String, bindung: String): String? = runCatching {
        val k = angaben()
        Base64.getEncoder().encodeToString(AblageChiffre { k }.verschluessle(wert.toByteArray(Charsets.UTF_8), ANGABE + bindung))
    }.getOrNull()

    /** Lesbar, weg (verändert, fremd gebunden, anderer Schlüssel) oder gesperrt (später noch einmal). */
    fun oeffneAngabe(gespeichert: String, bindung: String): Tresorbefund {
        // Der Schlüssel ausserhalb der Prüfung: Kann er gerade nicht, ist der Wert nicht weg.
        val k = runCatching { angaben() }.getOrElse { return Tresorbefund.Gesperrt }
        val roh = runCatching { Base64.getDecoder().decode(gespeichert) }.getOrElse { return Tresorbefund.Weg }
        return AblageChiffre { k }.entschluessle(roh, ANGABE + bindung)
            ?.let { Tresorbefund.Lesbar(it.toString(Charsets.UTF_8)) } ?: Tresorbefund.Weg
    }

    private companion object {
        const val ZWECK = "vertrauen:"
        const val ANGABE = "angabe:"
        const val NAMEN = "namen"
        /** 22 Zeichen Base64url sind 132 Bit: genug, dass zwei Server nie denselben Namen bekommen. */
        const val NAME_LAENGE = 22

        fun hmac(schluessel: ByteArray, text: String): ByteArray = Mac.getInstance("HmacSHA256").run {
            init(SecretKeySpec(schluessel, "HmacSHA256"))
            doFinal(text.toByteArray(Charsets.UTF_8))
        }
    }
}
